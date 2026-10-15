import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const ctx = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000';

const createCase = (body: object) => request(ctx.app).post('/api/cases').send(body);
const createClient = async (fullName: string) =>
  (await request(ctx.app).post('/api/clients').send({ fullName })).body.client as { id: string; fullName: string };
const addProceeding = (caseId: string, body: object) => request(ctx.app).post(`/api/cases/${caseId}/proceedings`).send(body);

describe('POST /api/cases', () => {
  it('saves an expediente with only its title', async () => {
    const res = await createCase({ title: 'Pérez c/ Gómez s/ daños y perjuicios' });

    expect(res.status).toBe(201);
    expect(res.body.case).toMatchObject({
      title: 'Pérez c/ Gómez s/ daños y perjuicios',
      number: '',
      court: '',
      practiceArea: null,
      status: 'ACTIVE',
      notes: '',
      clients: [],
      proceedingCount: 0,
      lastProceedingDate: null,
      pendingDeadlines: 0,
      nextDeadline: null,
    });
    expect(res.body.case.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('links one or more clients, listed by name', async () => {
    const zoe = await createClient('Zoe Ejemplo');
    const ana = await createClient('Ana Ejemplo');

    const res = await createCase({
      title: 'Ejemplo c/ Sur',
      number: '18452/2025',
      court: 'Juzgado Civil N° 7',
      practiceArea: 'CIVIL',
      status: 'PAUSED',
      notes: 'Esperando la pericia',
      clientIds: [zoe.id, ana.id, zoe.id],
    });

    expect(res.status).toBe(201);
    expect(res.body.case).toMatchObject({
      number: '18452/2025',
      court: 'Juzgado Civil N° 7',
      practiceArea: 'CIVIL',
      status: 'PAUSED',
      notes: 'Esperando la pericia',
    });
    expect(res.body.case.clients).toEqual([
      { id: ana.id, fullName: 'Ana Ejemplo' },
      { id: zoe.id, fullName: 'Zoe Ejemplo' },
    ]);
  });

  it('rejects bad data and clients that do not exist', async () => {
    expect((await createCase({ title: '' })).status).toBe(400);
    expect((await createCase({})).status).toBe(400);
    expect((await createCase({ title: 'x', status: 'ABIERTO' })).status).toBe(400);
    expect((await createCase({ title: 'x', practiceArea: 'ASTROLOGIA' })).status).toBe(400);
    const missingClient = await createCase({ title: 'x', clientIds: [NOT_A_RECORD] });
    expect(missingClient.status).toBe(400);
    expect(await ctx.db.case.count()).toBe(0);
  });
});

describe('GET /api/cases', () => {
  it('lists the expedientes touched most recently first, without the notes', async () => {
    const first = (await createCase({ title: 'Primero', notes: 'notas largas' })).body.case;
    const second = (await createCase({ title: 'Segundo' })).body.case;

    const list = await request(ctx.app).get('/api/cases');
    expect(list.status).toBe(200);
    expect(list.body.cases.map((c: { id: string }) => c.id)).toEqual([second.id, first.id]);
    expect(list.body.cases[0]).not.toHaveProperty('notes');
    expect(list.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Adding an actuación to the first one moves it to the top.
    await addProceeding(first.id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' });
    const after = await request(ctx.app).get('/api/cases');
    expect(after.body.cases.map((c: { id: string }) => c.id)).toEqual([first.id, second.id]);
  });

  it('filters by status and by client', async () => {
    const ana = await createClient('Ana Ejemplo');
    const open = (await createCase({ title: 'Abierto', clientIds: [ana.id] })).body.case;
    await createCase({ title: 'Cerrado', status: 'CLOSED' });

    const active = await request(ctx.app).get('/api/cases').query({ status: 'ACTIVE' });
    expect(active.body.cases.map((c: { id: string }) => c.id)).toEqual([open.id]);

    const ofAna = await request(ctx.app).get('/api/cases').query({ clientId: ana.id });
    expect(ofAna.body.cases.map((c: { id: string }) => c.id)).toEqual([open.id]);

    expect((await request(ctx.app).get('/api/cases').query({ status: 'ABIERTO' })).status).toBe(400);
  });

  it('shows when the expediente last moved and its next deadline', async () => {
    const created = (await createCase({ title: 'Con movimiento' })).body.case;
    await addProceeding(created.id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' });
    await addProceeding(created.id, { date: '2025-05-05', kind: 'RESOLUCION', title: 'Providencia' });
    // A hearing still to come is not the last movement.
    await addProceeding(created.id, { date: '2100-01-01', kind: 'AUDIENCIA', title: 'Audiencia fijada' });

    const deadline = (title: string, days: number, extra: object = {}) =>
      request(ctx.app)
        .post('/api/deadlines')
        .send({ title, notificationDate: '2026-10-08', days, dayType: 'CALENDAR', caseId: created.id, ...extra });
    const later = (await deadline('Más adelante', 20)).body.deadline;
    const sooner = (await deadline('Primero', 5)).body.deadline;
    const done = (await deadline('Ya cumplido', 1)).body.deadline;
    await request(ctx.app).patch(`/api/deadlines/${done.id}`).send({ status: 'DONE' });

    const [summary] = (await request(ctx.app).get('/api/cases')).body.cases;
    expect(summary).toMatchObject({ proceedingCount: 3, lastProceedingDate: '2025-05-05', pendingDeadlines: 2 });
    expect(summary.nextDeadline).toMatchObject({ id: sooner.id, title: 'Primero', dueDate: '2026-10-13' });
    expect(summary.nextDeadline.id).not.toBe(later.id);
  });
});

describe('GET /api/cases/:id', () => {
  it('returns the expediente with its notes', async () => {
    const created = (await createCase({ title: 'Con notas', notes: 'Algo importante' })).body.case;

    const res = await request(ctx.app).get(`/api/cases/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({ id: created.id, title: 'Con notas', notes: 'Algo importante' });
  });

  it('answers 404 for an expediente that does not exist and 400 for a bad id', async () => {
    expect((await request(ctx.app).get(`/api/cases/${NOT_A_RECORD}`)).status).toBe(404);
    expect((await request(ctx.app).get('/api/cases/no-es-un-id')).status).toBe(400);
  });
});

describe('PATCH /api/cases/:id', () => {
  it('changes only what it is given', async () => {
    const created = (await createCase({ title: 'Original', court: 'Juzgado 1', notes: 'Notas' })).body.case;

    const res = await request(ctx.app).patch(`/api/cases/${created.id}`).send({ status: 'CLOSED', number: '123/2025' });

    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({ title: 'Original', court: 'Juzgado 1', notes: 'Notas', status: 'CLOSED', number: '123/2025' });
  });

  it('replaces the list of clients', async () => {
    const ana = await createClient('Ana Ejemplo');
    const beto = await createClient('Beto Ejemplo');
    const created = (await createCase({ title: 'Con clientes', clientIds: [ana.id] })).body.case;

    const swapped = await request(ctx.app).patch(`/api/cases/${created.id}`).send({ clientIds: [beto.id] });
    expect(swapped.body.case.clients).toEqual([{ id: beto.id, fullName: 'Beto Ejemplo' }]);

    const cleared = await request(ctx.app).patch(`/api/cases/${created.id}`).send({ clientIds: [] });
    expect(cleared.body.case.clients).toEqual([]);

    const unknown = await request(ctx.app).patch(`/api/cases/${created.id}`).send({ clientIds: [NOT_A_RECORD] });
    expect(unknown.status).toBe(400);
  });

  it('rejects an empty change, bad data and an expediente that does not exist', async () => {
    const created = (await createCase({ title: 'x' })).body.case;
    expect((await request(ctx.app).patch(`/api/cases/${created.id}`).send({})).status).toBe(400);
    expect((await request(ctx.app).patch(`/api/cases/${created.id}`).send({ title: '' })).status).toBe(400);
    expect((await request(ctx.app).patch(`/api/cases/${NOT_A_RECORD}`).send({ title: 'y' })).status).toBe(404);
  });
});

describe('DELETE /api/cases/:id', () => {
  it('deletes the expediente and its actuaciones, and keeps its deadlines without the link', async () => {
    const created = (await createCase({ title: 'A borrar' })).body.case;
    await addProceeding(created.id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' });
    const deadline = (
      await request(ctx.app)
        .post('/api/deadlines')
        .send({ title: 'Contestar', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS', caseId: created.id })
    ).body.deadline;
    expect(deadline.case).toMatchObject({ id: created.id });

    const res = await request(ctx.app).delete(`/api/cases/${created.id}`);

    expect(res.status).toBe(204);
    expect((await request(ctx.app).get(`/api/cases/${created.id}`)).status).toBe(404);
    expect(await ctx.db.proceeding.count()).toBe(0);
    const kept = await request(ctx.app).get(`/api/deadlines/${deadline.id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.deadline.case).toBeNull();
    expect((await request(ctx.app).delete(`/api/cases/${created.id}`)).status).toBe(404);
  });

  it('keeps the expediente when one of its clients is deleted', async () => {
    const ana = await createClient('Ana Ejemplo');
    const beto = await createClient('Beto Ejemplo');
    const created = (await createCase({ title: 'De dos clientes', clientIds: [ana.id, beto.id] })).body.case;

    await request(ctx.app).delete(`/api/clients/${ana.id}`);

    const res = await request(ctx.app).get(`/api/cases/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.case.clients).toEqual([{ id: beto.id, fullName: 'Beto Ejemplo' }]);
  });
});

describe('deadlines of an expediente', () => {
  const term = { title: 'Contestar', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' };

  it('links a deadline to an expediente and filters by it', async () => {
    const mine = (await createCase({ title: 'Mi expediente', number: '45678/2026' })).body.case;
    const other = (await createCase({ title: 'Otro' })).body.case;

    const linked = await request(ctx.app).post('/api/deadlines').send({ ...term, caseId: mine.id });
    await request(ctx.app).post('/api/deadlines').send({ ...term, title: 'De otro', caseId: other.id });
    await request(ctx.app).post('/api/deadlines').send({ ...term, title: 'Suelto' });

    expect(linked.status).toBe(201);
    expect(linked.body.deadline.case).toEqual({ id: mine.id, title: 'Mi expediente', number: '45678/2026' });

    const list = await request(ctx.app).get('/api/deadlines').query({ caseId: mine.id });
    expect(list.body.deadlines.map((d: { title: string }) => d.title)).toEqual(['Contestar']);
  });

  it('links and unlinks a saved deadline', async () => {
    const created = (await createCase({ title: 'Mi expediente' })).body.case;
    const deadline = (await request(ctx.app).post('/api/deadlines').send(term)).body.deadline;
    expect(deadline.case).toBeNull();

    const linked = await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ caseId: created.id });
    expect(linked.body.deadline.case).toMatchObject({ id: created.id });

    const unlinked = await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ caseId: null });
    expect(unlinked.body.deadline.case).toBeNull();
  });

  it('rejects an expediente that does not exist', async () => {
    expect((await request(ctx.app).post('/api/deadlines').send({ ...term, caseId: NOT_A_RECORD })).status).toBe(400);
    const deadline = (await request(ctx.app).post('/api/deadlines').send(term)).body.deadline;
    expect((await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ caseId: NOT_A_RECORD })).status).toBe(400);
  });
});
