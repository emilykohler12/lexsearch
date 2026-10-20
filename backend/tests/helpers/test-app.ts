import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { FileStorage } from '../../src/lib/file-storage.js';
import { logger } from '../../src/lib/logger.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import type { AuthConfig } from '../../src/modules/auth/auth.service.js';
import type { LlmProvider } from '../../src/modules/llm/llm-provider.js';
import { FakeEmbeddingProvider, FakeNormativeSource, FakeOcrEngine } from './fakes.js';

export async function createTestApp(
  options: {
    llm?: LlmProvider | null;
    now?: () => Date;
    provincial?: boolean;
    hearingLimits?: { turns: number; heavy: number };
    /** Turns the login on (the other tests run with the system open). */
    auth?: AuthConfig;
    loginAttempts?: number;
    trustProxyHops?: number;
  } = {},
) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.includes('_test')) throw new Error('Integration tests must run against the test database');

  const db = createPrismaClient(databaseUrl);
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'lexsearch-test-'));
  const storage = new FileStorage(storageRoot);
  await storage.init();
  const ocr = new FakeOcrEngine();
  const normativeSource = new FakeNormativeSource();
  const provincialSource = new FakeNormativeSource({ id: 'BO_MISIONES', label: 'Boletín Oficial de Misiones (de prueba)', shortLabel: 'Misiones' });

  const { app, queue, deadlineWatcher, normativeWatcher } = createApp({
    db,
    storage,
    embeddings: new FakeEmbeddingProvider(),
    ocr,
    llm: options.llm ?? null,
    logger,
    corsOrigin: 'http://localhost:5180',
    maxUploadMb: 5,
    // Only the national bulletin, unless the test asks for the provincial one too.
    normativeSources: options.provincial ? [normativeSource, provincialSource] : [normativeSource],
    // The tests run the checks themselves, when and as they want.
    normativeAutoRun: false,
    // The practices of the audiencia simulator are many in one test file: the real limits are checked by one test of their own.
    hearingLimits: options.hearingLimits ?? { turns: 10_000, heavy: 10_000 },
    ...(options.now && { now: options.now }),
    ...(options.auth && { auth: options.auth }),
    ...(options.loginAttempts && { loginAttempts: options.loginAttempts }),
    ...(options.trustProxyHops && { trustProxyHops: options.trustProxyHops }),
  });

  return {
    app,
    queue,
    db,
    storage,
    ocr,
    /** The check that warns about deadlines; tests call it with the date they want to simulate. */
    watcher: deadlineWatcher,
    /** The bulletins the normative check reads (the provincial one only with `provincial: true`), and the check itself. */
    normativeSource,
    provincialSource,
    normativeWatcher,
    async reset() {
      await queue.idle();
      ocr.text = '';
      ocr.calls = 0;
      normativeSource.reset();
      provincialSource.reset();
      await db.normativeAlert.deleteMany();
      await db.normativeItem.deleteMany();
      await db.normativeTopic.deleteMany();
      await db.normativeRun.deleteMany();
      await db.outcomeEstimate.deleteMany();
      await db.hearingSimulation.deleteMany(); // its turns go with it
      await db.draft.deleteMany();
      await db.notification.deleteMany();
      await db.deadline.deleteMany();
      await db.case.deleteMany(); // its actuaciones and client links go with it
      await db.nonWorkingDay.deleteMany();
      await db.client.deleteMany();
      await db.agentInteraction.deleteMany();
      await db.document.deleteMany();
    },
    async close() {
      normativeWatcher.stop();
      await queue.idle();
      await db.$disconnect();
      await rm(storageRoot, { recursive: true, force: true });
    },
  };
}

/** Builds a real PDF in memory, one string per page. */
export async function makePdf(pages: string[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = pdf.addPage([595, 842]);
    let y = 800;
    for (const line of wrap(text, 90)) {
      page.drawText(line, { x: 40, y, size: 10, font });
      y -= 14;
    }
  }
  return Buffer.from(await pdf.save());
}

/** A plain white image, standing in for a photo or a scan (the fake OCR decides what it "reads"). */
export function makeImage(format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: '#ffffff' } })
    .toFormat(format)
    .toBuffer();
}

/** A PDF whose pages are images only, like the output of a scanner. */
export async function makeScannedPdf(pageCount = 1): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(await makeImage('png'));
  for (let i = 0; i < pageCount; i++) {
    pdf.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  return Buffer.from(await pdf.save());
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if ((line + ' ' + word).trim().length > width) {
        lines.push(line.trim());
        line = word;
      } else {
        line += ` ${word}`;
      }
    }
    lines.push(line.trim());
  }
  return lines;
}
