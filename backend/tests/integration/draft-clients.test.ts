import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp } from '../helpers/test-app.js';

// Kept apart from drafts.test.ts on purpose: creating a draft is rate limited (10 a minute per
// app), and each test file builds its own app.
const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  llm.agentCalls = [];
  llm.toolResults = {};
  await ctx.reset();
});

const request_ = {
  documentType: 'CARTA_DOCUMENTO',
  instructions: 'Intimar al empleador a registrar correctamente la relación laboral.',
  caseDetails: 'Trabajador: Juan Ejemplo. Empleador: Distribuidora Ejemplo S.A.',
};

const juan = {
  fullName: 'Juan Ejemplo',
  documentNumber: '30.000.000',
  counterpartyName: 'Distribuidora Ficticia S.A.',
  practiceArea: 'LABORAL',
  conflictSummary: 'Trabaja sin registrar desde marzo de 2025.',
  checklist: [{ id: 'a', text: 'Recibos de sueldo', done: false }],
  meetingNotes: 'Cobra $900.000 por mes, en mano.',
};

const createClient = async (body: object) =>
  (await request(ctx.app).post('/api/clients').send(body)).body.client as { id: string; fullName: string };

describe('drafts for a client', () => {
  it('lets the agent read the client file and links the draft to the client', async () => {
    const client = await createClient(juan);

    const res = await request(ctx.app).post('/api/drafts').send({ ...request_, caseDetails: '', clientId: client.id });

    expect(res.status).toBe(201);
    expect(res.body.draft.client).toEqual({ id: client.id, fullName: 'Juan Ejemplo' });
    // The fake agent wrote with what it read in the file.
    expect(res.body.draft.content).toContain('Remitente: Juan Ejemplo');
    expect(res.body.draft.content).toContain('Destinatario: Distribuidora Ficticia S.A.');

    const [call] = llm.agentCalls;
    expect(call!.tools.map((t) => t.name)).toEqual(['buscar_en_biblioteca', 'leer_documento', 'leer_ficha_cliente']);
    expect(call!.userMessage).toContain(`cliente_id: ${client.id}`);
    expect(call!.userMessage).toContain('Sin datos adicionales');
    expect(llm.toolResults.leer_ficha_cliente).toMatchObject({
      cliente: { nombre: 'Juan Ejemplo', documento: '30.000.000' },
      caso: { area_de_practica: 'Laboral', notas_de_la_primera_reunion: 'Cobra $900.000 por mes, en mano.' },
    });

    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'draft-generator' } });
    expect(interaction.input).toMatchObject({ clientId: client.id });
  });

  it('only lets the agent read the file of the client in the request', async () => {
    const client = await createClient(juan);
    const other = await createClient({ fullName: 'Otra Persona', meetingNotes: 'Datos privados de otra persona.' });
    await request(ctx.app).post('/api/drafts').send({ ...request_, clientId: client.id });

    const tool = llm.agentCalls[0]!.tools.find((t) => t.name === 'leer_ficha_cliente')!;

    await expect(tool.execute({ cliente_id: other.id })).rejects.toThrow('cliente_id inválido');
    await expect(tool.execute({})).rejects.toThrow('cliente_id inválido');
    await expect(tool.execute({ cliente_id: client.id.toUpperCase() })).resolves.toMatchObject({
      cliente: { nombre: 'Juan Ejemplo' },
    });
  });

  it('does not offer the client file when no client was chosen', async () => {
    await createClient(juan);

    const res = await request(ctx.app).post('/api/drafts').send(request_);

    expect(res.body.draft.client).toBeNull();
    expect(llm.agentCalls[0]!.tools.map((t) => t.name)).not.toContain('leer_ficha_cliente');
    expect(llm.agentCalls[0]!.userMessage).toContain('No se eligió cliente');
  });

  it('rejects a client that does not exist', async () => {
    const res = await request(ctx.app)
      .post('/api/drafts')
      .send({ ...request_, clientId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
    expect(llm.agentCalls).toHaveLength(0);
  });

  it('lists the drafts of one client', async () => {
    const client = await createClient(juan);
    await request(ctx.app).post('/api/drafts').send({ ...request_, clientId: client.id });
    await request(ctx.app).post('/api/drafts').send(request_);

    const all = await request(ctx.app).get('/api/drafts');
    expect(all.body.drafts).toHaveLength(2);

    const mine = await request(ctx.app).get(`/api/drafts?clientId=${client.id}`);
    expect(mine.status).toBe(200);
    expect(mine.body.drafts).toHaveLength(1);
    expect(mine.body.drafts[0].client).toEqual({ id: client.id, fullName: 'Juan Ejemplo' });

    expect((await request(ctx.app).get('/api/drafts?clientId=nope')).status).toBe(400);
  });

  it('keeps the draft when the client is deleted', async () => {
    const client = await createClient(juan);
    const created = await request(ctx.app).post('/api/drafts').send({ ...request_, clientId: client.id });
    const id = created.body.draft.id as string;

    expect((await request(ctx.app).delete(`/api/clients/${client.id}`)).status).toBe(204);

    const draft = await request(ctx.app).get(`/api/drafts/${id}`);
    expect(draft.status).toBe(200);
    expect(draft.body.draft.client).toBeNull();
    expect(draft.body.draft.content).toContain('Remitente: Juan Ejemplo');
  });
});
