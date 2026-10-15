import { readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { modelAnswer, movimientos } from '../helpers/case-fixtures.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp } from '../helpers/test-app.js';

// Split from proceeding-analysis.test.ts: this endpoint allows 10 readings a minute per app and
// each test file builds its own.
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

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000';

const newCase = async (app: typeof ctx.app = ctx.app) =>
  (await request(app).post('/api/cases').send({ title: 'Ramírez c/ Transportes' })).body.case as { id: string };
const analyzeText = (caseId: string, text: string) => request(ctx.app).post(`/api/cases/${caseId}/proceedings/analyze`).send({ text });
const analyzeFile = (caseId: string, file: Buffer, name: string, app: typeof ctx.app = ctx.app) =>
  request(app).post(`/api/cases/${caseId}/proceedings/analyze`).attach('file', file, name);

/** Nothing is left behind: a file is read and deleted, and reading saves no actuación. */
async function expectNothingKept(context: typeof ctx) {
  expect(await readdir(context.storage.tmpDir)).toEqual([]);
  expect(await context.db.proceeding.count()).toBe(0);
}

describe('POST /api/cases/:id/proceedings/analyze — errors', () => {
  it('rejects a text that is too short, a format it cannot read and a file with nothing in it', async () => {
    const { id } = await newCase();

    expect((await analyzeText(id, 'corto')).status).toBe(400);
    expect((await request(ctx.app).post(`/api/cases/${id}/proceedings/analyze`).send({})).status).toBe(400);

    const unsupported = await analyzeFile(id, Buffer.from('MZ binary'), 'programa.exe');
    expect(unsupported.status).toBe(400);
    expect(unsupported.body.error.message).toContain('formato no soportado');

    const empty = await analyzeFile(id, Buffer.from('   '), 'vacio.txt');
    expect(empty.status).toBe(400);

    expect(llm.structuredCalls).toHaveLength(0);
    await expectNothingKept(ctx);
  });

  it('answers 404 for an expediente that does not exist, without calling the model, and deletes the file', async () => {
    expect((await analyzeText(NOT_A_RECORD, movimientos)).status).toBe(404);
    expect((await analyzeFile(NOT_A_RECORD, Buffer.from(movimientos), 'movimientos.txt')).status).toBe(404);
    expect((await analyzeFile('no-es-un-id', Buffer.from(movimientos), 'movimientos.txt')).status).toBe(400);

    expect(llm.structuredCalls).toHaveLength(0);
    await expectNothingKept(ctx);
  });

  it('needs the AI to be configured, and still deletes the file', async () => {
    const { id } = await newCase(noLlm.app);

    const res = await analyzeFile(id, Buffer.from(movimientos), 'movimientos.txt', noLlm.app);

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
    await expectNothingKept(noLlm);
  });

  it('records a failed run and reports the error', async () => {
    const { id } = await newCase();
    llm.structuredData = modelAnswer;
    llm.structuredError = new UpstreamError('LLM_UNAVAILABLE', 'Gemini no está disponible en este momento.');

    const res = await analyzeText(id, movimientos);

    expect(res.status).toBe(502);
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'proceeding-extraction' } });
    expect(interaction).toMatchObject({ status: 'FAILED', errorMessage: 'Gemini no está disponible en este momento.' });
    expect(await ctx.db.proceeding.count()).toBe(0);
  });
});
