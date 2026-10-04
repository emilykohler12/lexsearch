import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp, makePdf } from '../helpers/test-app.js';

const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
const noLlm = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
  await noLlm.close();
});
beforeEach(async () => {
  llm.calls = [];
  await ctx.reset();
});

async function seedLibrary() {
  await request(ctx.app)
    .post('/api/documents')
    .field('category', 'LEGISLACION')
    .attach(
      'files',
      await makePdf([
        'CÓDIGO PROCESAL. ARTÍCULO 338.- Traslado de la demanda. Presentada la demanda, el juez dará traslado de ella al demandado para que comparezca y la conteste dentro de quince días.',
        'ARTÍCULO 245.- En los casos de despido dispuesto por el empleador sin justa causa corresponde una indemnización equivalente a un mes de sueldo por cada año de servicio.',
      ]),
      'Codigo_Procesal.pdf',
    );
  await request(ctx.app)
    .post('/api/documents')
    .field('category', 'MODELO')
    .attach('files', Buffer.from('Modelo de contrato de locación comercial.\n\nCláusula de rescisión anticipada.'), 'Locacion.txt');
  await ctx.queue.idle();
}

describe('POST /api/rag/search', () => {
  it('finds fragments by meaning and by exact words, with their page', async () => {
    await seedLibrary();
    const res = await request(ctx.app).post('/api/rag/search').send({ query: 'plazo para contestar la demanda' });

    expect(res.status).toBe(200);
    const [top] = res.body.results;
    expect(top).toMatchObject({ documentTitle: 'Codigo Procesal', category: 'LEGISLACION', pageStart: 1 });
    expect(top.content).toContain('quince días');
    expect(top.matchedBy).toEqual(expect.arrayContaining(['semantic', 'keyword']));
  });

  it('ignores accents in keyword search', async () => {
    await seedLibrary();
    const res = await request(ctx.app).post('/api/rag/search').send({ query: 'indemnizacion despido' });
    const top = res.body.results[0];
    expect(top.content).toContain('indemnización');
    expect(top.pageEnd).toBe(2);
    expect(top.matchedBy).toContain('keyword');
  });

  it('filters by category', async () => {
    await seedLibrary();
    const res = await request(ctx.app)
      .post('/api/rag/search')
      .send({ query: 'rescisión', categories: ['MODELO'] });
    expect(res.body.results.length).toBeGreaterThan(0);
    for (const hit of res.body.results) expect(hit.category).toBe('MODELO');
  });

  it('validates the query', async () => {
    const res = await request(ctx.app).post('/api/rag/search').send({ query: '' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/rag/ask', () => {
  it('answers with citations pointing to numbered sources and records the interaction', async () => {
    await seedLibrary();
    const res = await request(ctx.app).post('/api/rag/ask').send({ question: '¿Qué plazo hay para contestar la demanda?' });

    expect(res.status).toBe(200);
    expect(res.body.blocks[1].citations[0]).toMatchObject({ sourceNumber: 1 });
    expect(res.body.sources[0]).toMatchObject({ number: 1 });
    expect(res.body.sources[0].content).toContain(res.body.blocks[1].citations[0].citedText);
    expect(res.body.model).toBe('fake-model');

    // The model received the fragments as separate titled documents, plus the question.
    const [call] = llm.calls;
    expect(call!.question).toBe('¿Qué plazo hay para contestar la demanda?');
    expect(call!.documents[0]!.title).toMatch(/Codigo Procesal — págs?\. \d/);
    expect(call!.systemPrompt).toContain('LexSearch');

    const history = await request(ctx.app).get('/api/interactions?module=rag-qa');
    expect(history.body.interactions[0]).toMatchObject({
      id: res.body.interactionId,
      question: '¿Qué plazo hay para contestar la demanda?',
      status: 'SUCCESS',
    });
    const detail = await request(ctx.app).get(`/api/interactions/${res.body.interactionId}`);
    expect(detail.body.interaction).toMatchObject({ promptVersion: 'rag-answer.v2', inputTokens: 1000 });
  });

  it('refuses politely when the library is empty', async () => {
    const res = await request(ctx.app).post('/api/rag/ask').send({ question: '¿Qué plazo hay?' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMPTY_LIBRARY');
    expect(llm.calls).toHaveLength(0);
  });

  it('explains that the API key is missing when no LLM is configured', async () => {
    const res = await request(noLlm.app).post('/api/rag/ask').send({ question: '¿Qué plazo hay?' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'LLM_NOT_CONFIGURED' });
  });
});

describe('GET /api/health', () => {
  it('reports database, embeddings and LLM status', async () => {
    const res = await request(ctx.app).get('/api/health');
    expect(res.body).toMatchObject({
      status: 'ok',
      database: 'ok',
      embeddings: { status: 'ready' },
      llm: { configured: true, model: 'fake-model' },
    });
    const without = await request(noLlm.app).get('/api/health');
    expect(without.body.llm).toEqual({ configured: false });
  });
});
