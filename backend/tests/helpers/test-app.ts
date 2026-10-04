import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { FileStorage } from '../../src/lib/file-storage.js';
import { logger } from '../../src/lib/logger.js';
import { createPrismaClient } from '../../src/lib/prisma.js';
import type { LlmProvider } from '../../src/modules/llm/llm-provider.js';
import { FakeEmbeddingProvider, FakeOcrEngine } from './fakes.js';

export async function createTestApp(options: { llm?: LlmProvider | null } = {}) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.includes('_test')) throw new Error('Integration tests must run against the test database');

  const db = createPrismaClient(databaseUrl);
  const storageRoot = await mkdtemp(path.join(os.tmpdir(), 'lexsearch-test-'));
  const storage = new FileStorage(storageRoot);
  await storage.init();
  const ocr = new FakeOcrEngine();

  const { app, queue } = createApp({
    db,
    storage,
    embeddings: new FakeEmbeddingProvider(),
    ocr,
    llm: options.llm ?? null,
    logger,
    corsOrigin: 'http://localhost:5180',
    maxUploadMb: 5,
  });

  return {
    app,
    queue,
    db,
    storage,
    ocr,
    async reset() {
      await queue.idle();
      ocr.text = '';
      ocr.calls = 0;
      await db.draft.deleteMany();
      await db.agentInteraction.deleteMany();
      await db.document.deleteMany();
    },
    async close() {
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
