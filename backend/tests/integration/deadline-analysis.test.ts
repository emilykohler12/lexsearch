import { readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp, makePdf, makeScannedPdf } from '../helpers/test-app.js';

const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
const noLlm = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
  await noLlm.close();
});
beforeEach(async () => {
  llm.structuredCalls = [];
  llm.structuredData = {};
  llm.structuredError = null;
  await ctx.reset();
});

const cedula = [
  'JUZGADO NACIONAL EN LO CIVIL N° 12 - CEDULA DE NOTIFICACION',
  'Expte. N° 45.678/2026 "PEREZ, JUAN C/ GOMEZ, ANA S/ DAÑOS Y PERJUICIOS"',
  'Buenos Aires, 1 de octubre de 2026.',
  'Córrase traslado de la demanda a la parte demandada, por el plazo de quince (15) días, bajo apercibimiento de rebeldía.',
  'Diligenciada el 6 de octubre de 2026.',
].join('\n');

const modelAnswer = {
  summary: 'Traslado de la demanda de daños y perjuicios.',
  documentDate: '2026-10-01',
  notificationDate: '2026-10-06',
  caseReference: 'Juzgado Nacional en lo Civil N° 12 — PEREZ, JUAN C/ GOMEZ, ANA — Expte. 45.678/2026',
  terms: [
    {
      title: 'Contestar la demanda',
      days: 15,
      dayType: 'HABILES',
      quote: 'Córrase traslado de la demanda a la parte demandada, por el plazo de quince (15) días',
    },
  ],
};

const analyze = (app: typeof ctx.app, file: Buffer, name: string) =>
  request(app).post('/api/deadlines/analyze').attach('file', file, name);

/** Nothing is left behind: the document is read and deleted, not added to the library. */
async function expectNothingKept(context: typeof ctx) {
  expect(await readdir(context.storage.tmpDir)).toEqual([]);
  expect(await context.db.document.count()).toBe(0);
}

describe('POST /api/deadlines/analyze', () => {
  it('reads a cédula and proposes its terms, with the quote checked against the document', async () => {
    llm.structuredData = modelAnswer;

    const res = await analyze(ctx.app, await makePdf([cedula]), 'cedula.pdf');

    expect(res.status).toBe(200);
    expect(res.body.proposal).toEqual({
      summary: 'Traslado de la demanda de daños y perjuicios.',
      documentDate: '2026-10-01',
      notificationDate: '2026-10-06',
      caseReference: 'Juzgado Nacional en lo Civil N° 12 — PEREZ, JUAN C/ GOMEZ, ANA — Expte. 45.678/2026',
      terms: [
        {
          title: 'Contestar la demanda',
          days: 15,
          dayType: 'BUSINESS',
          quote: 'Córrase traslado de la demanda a la parte demandada, por el plazo de quince (15) días',
          quoteVerified: true,
        },
      ],
    });

    // The model got the text of the document as data, with the extraction instructions.
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain('Córrase traslado de la demanda');
    expect(call!.userMessage).toContain('no instrucciones');
    expect(call!.systemPrompt).toContain('plazos');

    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'deadline-extraction' } });
    expect(interaction).toMatchObject({ status: 'SUCCESS', promptVersion: 'deadline-extraction.v1', model: 'fake-model' });
    expect(interaction.input).toMatchObject({ fileName: 'cedula.pdf', ocrPageCount: 0 });
    await expectNothingKept(ctx);
  });

  it('flags a quote the model made up, and does not show it', async () => {
    llm.structuredData = {
      ...modelAnswer,
      terms: [{ ...modelAnswer.terms[0]!, quote: 'El plazo es de diez días corridos' }],
    };

    const res = await analyze(ctx.app, await makePdf([cedula]), 'cedula.pdf');

    expect(res.body.proposal.terms[0]).toMatchObject({ days: 15, quote: '', quoteVerified: false });
  });

  it('leaves the days at 0 when the document does not state them, for the lawyer to complete', async () => {
    llm.structuredData = {
      ...modelAnswer,
      notificationDate: '',
      terms: [{ title: 'Contestar el traslado del incidente', days: 0, dayType: 'HABILES', quote: '' }],
    };

    const res = await analyze(ctx.app, Buffer.from('Córrase traslado del incidente a la contraria.'), 'decreto.txt');

    expect(res.status).toBe(200);
    expect(res.body.proposal.notificationDate).toBe('');
    expect(res.body.proposal.terms[0]).toMatchObject({ days: 0, dayType: 'BUSINESS', quoteVerified: false });
  });

  it('reads a scanned cédula with OCR', async () => {
    ctx.ocr.text = cedula;
    llm.structuredData = modelAnswer;

    const res = await analyze(ctx.app, await makeScannedPdf(1), 'escaneo.pdf');

    expect(res.status).toBe(200);
    expect(ctx.ocr.calls).toBe(1);
    expect(res.body.proposal.terms[0].quoteVerified).toBe(true);
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'deadline-extraction' } });
    expect(interaction.input).toMatchObject({ ocrPageCount: 1 });
  });

  it('rejects a request with no file, a format it cannot read, or a file with nothing in it', async () => {
    expect((await request(ctx.app).post('/api/deadlines/analyze')).status).toBe(400);

    const unsupported = await analyze(ctx.app, Buffer.from('MZ binary'), 'programa.exe');
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.message).toContain('formato no soportado');

    const empty = await analyze(ctx.app, Buffer.from('   '), 'vacio.txt');
    expect(empty.status).toBe(400);

    expect(llm.structuredCalls).toHaveLength(0);
    await expectNothingKept(ctx);
  });

  it('needs the AI to be configured, and still deletes the file', async () => {
    const res = await analyze(noLlm.app, Buffer.from(cedula), 'cedula.txt');

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
    await expectNothingKept(noLlm);
  });

  it('records a failed run and reports the error', async () => {
    llm.structuredError = new UpstreamError('LLM_UNAVAILABLE', 'Gemini no está disponible en este momento.');

    const res = await analyze(ctx.app, Buffer.from(cedula), 'cedula.txt');

    expect(res.status).toBe(502);
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'deadline-extraction' } });
    expect(interaction).toMatchObject({ status: 'FAILED', errorMessage: 'Gemini no está disponible en este momento.' });
    await expectNothingKept(ctx);
  });

  it('turns the proposal into a saved deadline with the due date calculated by the system', async () => {
    llm.structuredData = modelAnswer;
    const { proposal } = (await analyze(ctx.app, await makePdf([cedula]), 'cedula.pdf')).body;
    const term = proposal.terms[0];

    const saved = await request(ctx.app)
      .post('/api/deadlines')
      .send({
        title: term.title,
        caseReference: proposal.caseReference,
        notificationDate: proposal.notificationDate,
        days: term.days,
        dayType: term.dayType,
        sourceQuote: term.quote,
      });

    // Notified Tuesday 6/10: 15 business days (Monday 12/10 is a holiday) end on Wednesday 28/10.
    expect(saved.status).toBe(201);
    expect(saved.body.deadline).toMatchObject({ dueDate: '2026-10-28', sourceQuote: term.quote });
  });
});
