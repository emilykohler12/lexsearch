import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { CONTRATO, modelAnswer, TESTIGO } from '../helpers/contradiction-fixtures.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp } from '../helpers/test-app.js';

// Split from contradiction-analysis.test.ts: this endpoint allows 10 comparisons a minute per app
// and each test file builds its own.
const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
const noLlm = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
  await noLlm.close();
});
beforeEach(async () => {
  llm.structuredCalls = [];
  llm.structuredData = { findings: [] };
  llm.structuredError = null;
  await ctx.reset();
});

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000';

async function newCase(title = 'Ramírez c/ Transportes') {
  return (await request(ctx.app).post('/api/cases').send({ title })).body.case as { id: string };
}

async function uploadDocument(name: string, text: string, caseId?: string): Promise<{ id: string; title: string; status: string }> {
  let req = request(ctx.app).post('/api/documents').field('category', 'PRUEBA');
  if (caseId) req = req.field('caseId', caseId);
  const res = await req.attach('files', Buffer.from(text), name);
  await ctx.queue.idle();
  return (await request(ctx.app).get(`/api/documents/${res.body.results[0].document.id}`)).body.document;
}

const analyze = (caseId: string, body: object, app: typeof ctx.app = ctx.app) =>
  request(app).post(`/api/cases/${caseId}/contradictions/analyze`).send(body);

describe('POST /api/cases/:id/contradictions/analyze — errors', () => {
  it('needs between two and eight documents of the expediente', async () => {
    const { id } = await newCase();
    const a = await uploadDocument('Contrato.txt', CONTRATO, id);

    // (The rest of what the body can get wrong is checked with the schema, in the unit tests.)
    expect((await analyze(id, { documentIds: [a.id] })).status).toBe(400);
    expect((await analyze(id, { documentIds: [a.id, a.id] })).status).toBe(400); // the same one twice is one
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('refuses a document that does not exist, that belongs to another expediente or to nobody', async () => {
    const mine = await newCase();
    const other = await newCase('Otro');
    const own = await uploadDocument('Contrato.txt', CONTRATO, mine.id);
    const elsewhere = await uploadDocument('Declaración.txt', TESTIGO, other.id);
    const loose = await uploadDocument('Suelto.txt', 'Un documento de la biblioteca general, sin expediente.');

    const missing = await analyze(mine.id, { documentIds: [own.id, NOT_A_RECORD] });
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('no existe');

    const foreign = await analyze(mine.id, { documentIds: [own.id, elsewhere.id] });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.message).toContain('Declaración');
    expect(foreign.body.error.message).toContain('no pertenece');

    expect((await analyze(mine.id, { documentIds: [own.id, loose.id] })).status).toBe(400);
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('refuses a document that is not ready yet or that could not be processed', async () => {
    const { id } = await newCase();
    const ready = await uploadDocument('Contrato.txt', CONTRATO, id);
    // Nothing to read in it: the library marks it as failed.
    const blank = await uploadDocument('En blanco.txt', '   ', id);
    expect(blank.status).toBe('FAILED');
    const pending = await ctx.db.document.create({
      data: {
        title: 'Recién subido',
        originalName: 'recien.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        storagePath: 'x/recien.txt',
        category: 'PRUEBA',
        caseId: id,
      },
    });

    const failed = await analyze(id, { documentIds: [ready.id, blank.id] });
    expect(failed.status).toBe(400);
    expect(failed.body.error.message).toContain('no se pudo procesar');

    const processing = await analyze(id, { documentIds: [ready.id, pending.id] });
    expect(processing.status).toBe(400);
    expect(processing.body.error.message).toContain('Recién subido');
    expect(processing.body.error.message).toContain('se está procesando');
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('answers 404 for an expediente that does not exist', async () => {
    const { id } = await newCase();
    const a = await uploadDocument('Contrato.txt', CONTRATO, id);
    const b = await uploadDocument('Declaración.txt', TESTIGO, id);

    expect((await analyze(NOT_A_RECORD, { documentIds: [a.id, b.id] })).status).toBe(404);
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('needs the AI to be configured', async () => {
    const { id } = await newCase();
    const a = await uploadDocument('Contrato.txt', CONTRATO, id);
    const b = await uploadDocument('Declaración.txt', TESTIGO, id);

    const res = await analyze(id, { documentIds: [a.id, b.id] }, noLlm.app);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('records a failed run and reports the error', async () => {
    const { id } = await newCase();
    const a = await uploadDocument('Contrato.txt', CONTRATO, id);
    const b = await uploadDocument('Declaración.txt', TESTIGO, id);
    llm.structuredData = modelAnswer;
    llm.structuredError = new UpstreamError('LLM_TIMEOUT', 'Gemini tardó demasiado en responder. Probá de nuevo en unos minutos.', 504);

    const res = await analyze(id, { documentIds: [a.id, b.id] });

    expect(res.status).toBe(504);
    expect(res.body.error.code).toBe('LLM_TIMEOUT');
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'contradiction-detection' } });
    expect(interaction).toMatchObject({ status: 'FAILED', errorMessage: 'Gemini tardó demasiado en responder. Probá de nuevo en unos minutos.' });
    expect(await ctx.db.contradiction.count()).toBe(0);
  });
});
