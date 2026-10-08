import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { UpstreamError } from '../../src/lib/errors.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp } from '../helpers/test-app.js';

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

const createClient = (body: object) => request(ctx.app).post('/api/clients').send(body);

const fullClient = {
  fullName: 'Juan Ejemplo',
  personType: 'FISICA',
  documentNumber: '30.000.000',
  email: 'juan@ejemplo.com',
  phone: '11 5555-0000',
  address: 'Av. Siempreviva 742, CABA',
  counterpartyName: 'Distribuidora Ficticia S.A.',
  counterpartyDocument: '30-00000000-0',
  counterpartyAddress: 'Calle Falsa 123, CABA',
  practiceArea: 'LABORAL',
  conflictSummary: 'Trabaja sin registrar desde marzo de 2025.',
  claim: 'Que registren la relación laboral.',
  checklist: [
    { id: 'a', text: 'Recibos de sueldo', done: false },
    { id: 'b', text: 'DNI', done: true },
  ],
  meetingNotes: 'Cobra $900.000 por mes, en mano.',
};

const emptyProposal = {
  fullName: '',
  personType: 'FISICA',
  documentNumber: '',
  email: '',
  phone: '',
  address: '',
  counterpartyName: '',
  counterpartyDocument: '',
  counterpartyAddress: '',
  practiceArea: '',
  conflictSummary: '',
  claim: '',
  missingDocuments: [],
};

describe('POST /api/clients', () => {
  it('creates a client file with only the name', async () => {
    const res = await createClient({ fullName: 'Juan Ejemplo' });

    expect(res.status).toBe(201);
    expect(res.body.client).toMatchObject({
      fullName: 'Juan Ejemplo',
      personType: 'FISICA',
      documentNumber: '',
      practiceArea: null,
      checklist: [],
      meetingNotes: '',
    });
    expect(res.body.client.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores every field, including the checklist', async () => {
    const created = await createClient(fullClient);
    expect(created.status).toBe(201);

    const res = await request(ctx.app).get(`/api/clients/${created.body.client.id}`);
    expect(res.status).toBe(200);
    expect(res.body.client).toMatchObject(fullClient);
  });

  it('validates the data', async () => {
    expect((await createClient({ fullName: '' })).status).toBe(400);
    expect((await createClient({})).status).toBe(400);
    expect((await createClient({ fullName: 'Juan', email: 'juan@' })).status).toBe(400);
    expect((await createClient({ fullName: 'Juan', practiceArea: 'ASTROLOGIA' })).status).toBe(400);
    expect((await createClient({ fullName: 'Juan', checklist: [{ id: 'a', text: '', done: false }] })).status).toBe(400);
  });
});

describe('GET /api/clients', () => {
  it('lists summaries with the most recently updated first, and no long texts', async () => {
    const first = await createClient({ ...fullClient, fullName: 'Ana Primera' });
    const second = await createClient({ fullName: 'Beto Segundo' });
    // Touching the first one moves it to the top.
    await request(ctx.app).patch(`/api/clients/${first.body.client.id}`).send({ phone: '11 4444-0000' });

    const res = await request(ctx.app).get('/api/clients');

    expect(res.status).toBe(200);
    expect(res.body.clients.map((c: { fullName: string }) => c.fullName)).toEqual(['Ana Primera', 'Beto Segundo']);
    expect(res.body.clients[0]).toMatchObject({
      id: first.body.client.id,
      practiceArea: 'LABORAL',
      counterpartyName: 'Distribuidora Ficticia S.A.',
      pendingDocuments: 1,
      totalDocuments: 2,
    });
    expect(res.body.clients[0]).not.toHaveProperty('meetingNotes');
    expect(res.body.clients[1]).toMatchObject({ id: second.body.client.id, pendingDocuments: 0, totalDocuments: 0 });
  });
});

describe('PATCH /api/clients/:id', () => {
  it('changes only what it receives', async () => {
    const created = await createClient(fullClient);
    const id = created.body.client.id as string;

    const res = await request(ctx.app).patch(`/api/clients/${id}`).send({ phone: '11 4444-0000' });

    expect(res.status).toBe(200);
    // Everything else (including what has a default) stays as it was.
    expect(res.body.client).toMatchObject({ ...fullClient, phone: '11 4444-0000' });
  });

  it('ticks a checklist item and clears the area of practice', async () => {
    const created = await createClient(fullClient);
    const id = created.body.client.id as string;

    const res = await request(ctx.app)
      .patch(`/api/clients/${id}`)
      .send({
        practiceArea: null,
        checklist: fullClient.checklist.map((item) => ({ ...item, done: true })),
      });

    expect(res.body.client.practiceArea).toBeNull();
    expect(res.body.client.checklist.every((item: { done: boolean }) => item.done)).toBe(true);
    const list = await request(ctx.app).get('/api/clients');
    expect(list.body.clients[0]).toMatchObject({ pendingDocuments: 0, totalDocuments: 2 });
  });

  it('rejects an empty request, bad data and unknown clients', async () => {
    const created = await createClient(fullClient);
    const id = created.body.client.id as string;

    expect((await request(ctx.app).patch(`/api/clients/${id}`).send({})).status).toBe(400);
    expect((await request(ctx.app).patch(`/api/clients/${id}`).send({ fullName: '' })).status).toBe(400);
    expect((await request(ctx.app).patch('/api/clients/not-a-uuid').send({ phone: '1' })).status).toBe(400);
    expect(
      (await request(ctx.app).patch('/api/clients/00000000-0000-4000-8000-000000000000').send({ phone: '1' })).status,
    ).toBe(404);
  });
});

describe('DELETE /api/clients/:id', () => {
  it('deletes the client', async () => {
    const created = await createClient(fullClient);
    const id = created.body.client.id as string;

    expect((await request(ctx.app).delete(`/api/clients/${id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/clients/${id}`)).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/clients/${id}`)).status).toBe(404);
  });
});

describe('POST /api/clients/analyze-notes', () => {
  const notes = 'Vino Juan Ejemplo (DNI 30.000.000). Trabaja en Distribuidora Ficticia S.A. sin estar registrado.';

  it('returns a cleaned proposal for the lawyer to review, and logs the run', async () => {
    llm.structuredData = {
      fullName: 'Juan Ejemplo',
      personType: 'FISICA',
      documentNumber: '30.000.000',
      email: 'No consta',
      phone: '',
      address: '',
      counterpartyName: 'Distribuidora Ficticia S.A.',
      counterpartyDocument: '',
      counterpartyAddress: '',
      practiceArea: 'laboral',
      conflictSummary: 'Trabaja sin estar registrado.',
      claim: '',
      missingDocuments: ['Recibos de sueldo', 'recibos de sueldo', 'Telegramas'],
    };

    const res = await request(ctx.app).post('/api/clients/analyze-notes').send({ notes });

    expect(res.status).toBe(200);
    expect(res.body.proposal).toEqual({
      fullName: 'Juan Ejemplo',
      personType: 'FISICA',
      documentNumber: '30.000.000',
      email: '',
      phone: '',
      address: '',
      counterpartyName: 'Distribuidora Ficticia S.A.',
      counterpartyDocument: '',
      counterpartyAddress: '',
      practiceArea: 'LABORAL',
      conflictSummary: 'Trabaja sin estar registrado.',
      claim: '',
      missingDocuments: ['Recibos de sueldo', 'Telegramas'],
    });

    // The model got the notes as data, with the intake instructions.
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain(notes);
    expect(call!.systemPrompt).toContain('ficha');

    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'client-intake' } });
    expect(interaction).toMatchObject({ status: 'SUCCESS', promptVersion: 'client-intake.v1', model: 'fake-model' });
    expect((interaction.output as { proposal: { fullName: string } }).proposal.fullName).toBe('Juan Ejemplo');
  });

  it('saves nothing: the proposal only fills the form', async () => {
    llm.structuredData = { ...emptyProposal, fullName: 'Juan Ejemplo' };

    await request(ctx.app).post('/api/clients/analyze-notes').send({ notes });

    const list = await request(ctx.app).get('/api/clients');
    expect(list.body.clients).toEqual([]);
  });

  it('needs real notes', async () => {
    expect((await request(ctx.app).post('/api/clients/analyze-notes').send({ notes: 'hola' })).status).toBe(400);
    expect((await request(ctx.app).post('/api/clients/analyze-notes').send({})).status).toBe(400);
    expect(llm.structuredCalls).toHaveLength(0);
  });

  it('needs the AI to be configured', async () => {
    const res = await request(noLlm.app).post('/api/clients/analyze-notes').send({ notes });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
  });

  it('records a failed run and reports the error', async () => {
    llm.structuredError = new UpstreamError('LLM_UNAVAILABLE', 'Gemini no está disponible en este momento.');

    const res = await request(ctx.app).post('/api/clients/analyze-notes').send({ notes });

    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('LLM_UNAVAILABLE');
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'client-intake' } });
    expect(interaction).toMatchObject({ status: 'FAILED', errorMessage: 'Gemini no está disponible en este momento.' });
  });
});
