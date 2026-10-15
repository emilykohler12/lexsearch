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

const term = { notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' };
const create = (body: object) => request(ctx.app).post('/api/deadlines').send(body);
const createClient = async (fullName: string) =>
  (await request(ctx.app).post('/api/clients').send({ fullName })).body.client as { id: string };

describe('POST /api/deadlines/calculate', () => {
  it('gives the due date and the days that did not count, without saving anything', async () => {
    const res = await request(ctx.app)
      .post('/api/deadlines/calculate')
      .send({ notificationDate: '2026-10-09', days: 15, dayType: 'BUSINESS' });

    expect(res.status).toBe(200);
    expect(res.body.dueDate).toBe('2026-11-02');
    expect(res.body.skipped).toHaveLength(9);
    expect(res.body.skipped[2]).toEqual({ date: '2026-10-12', reason: 'Día del Respeto a la Diversidad Cultural' });
    expect(typeof res.body.daysLeft).toBe('number');
    expect((await request(ctx.app).get('/api/deadlines')).body.deadlines).toEqual([]);
  });

  it('counts calendar days too', async () => {
    const res = await request(ctx.app)
      .post('/api/deadlines/calculate')
      .send({ notificationDate: '2026-10-08', days: 10, dayType: 'CALENDAR' });
    expect(res.body.dueDate).toBe('2026-10-19');
    expect(res.body.skipped).toEqual([{ date: '2026-10-18', reason: 'Domingo' }]);
  });

  it('validates the term', async () => {
    const calculate = (body: object) => request(ctx.app).post('/api/deadlines/calculate').send(body);
    expect((await calculate({ ...term, days: 0 })).status).toBe(400);
    expect((await calculate({ ...term, notificationDate: '2026-02-30' })).status).toBe(400);
    expect((await calculate({ ...term, dayType: 'HORAS' })).status).toBe(400);
    expect((await calculate({})).status).toBe(400);
  });
});

describe('POST /api/deadlines', () => {
  it('saves a deadline with its due date calculated', async () => {
    const res = await create({ ...term, title: 'Contestar demanda', caseReference: 'Pérez c/ Gómez — Expte. 45678/2026' });

    expect(res.status).toBe(201);
    expect(res.body.deadline).toMatchObject({
      title: 'Contestar demanda',
      caseReference: 'Pérez c/ Gómez — Expte. 45678/2026',
      notificationDate: '2026-10-08',
      days: 5,
      dayType: 'BUSINESS',
      dueDate: '2026-10-16',
      status: 'PENDING',
      completedAt: null,
      client: null,
      notes: '',
      sourceQuote: '',
    });
    expect(res.body.deadline.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(typeof res.body.deadline.daysLeft).toBe('number');
  });

  it('links a client', async () => {
    const client = await createClient('Juan Ejemplo');
    const res = await create({ ...term, title: 'Contestar demanda', clientId: client.id });
    expect(res.body.deadline.client).toEqual({ id: client.id, fullName: 'Juan Ejemplo' });
  });

  it('rejects a client that does not exist and bad data', async () => {
    expect((await create({ ...term, title: 'x', clientId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await create({ ...term, title: '' })).status).toBe(400);
    expect((await create({ ...term, title: 'x', days: 0 })).status).toBe(400);
    expect((await create({ ...term, title: 'x', notificationDate: '2026-02-30' })).status).toBe(400);
    expect((await create({ title: 'x' })).status).toBe(400);
  });
});

describe('POST /api/deadlines/batch', () => {
  it('saves the terms of one document together', async () => {
    const res = await request(ctx.app)
      .post('/api/deadlines/batch')
      .send({
        items: [
          { ...term, title: 'Pagar el capital', days: 5 },
          { ...term, title: 'Constituir domicilio electrónico', days: 3, dayType: 'CALENDAR' },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.deadlines.map((d: { title: string; dueDate: string }) => [d.title, d.dueDate])).toEqual([
      ['Pagar el capital', '2026-10-16'],
      ['Constituir domicilio electrónico', '2026-10-13'], // Sunday, then the Monday holiday
    ]);
  });

  it('saves nothing when one of them is wrong', async () => {
    const res = await request(ctx.app)
      .post('/api/deadlines/batch')
      .send({ items: [{ ...term, title: 'Bien' }, { ...term, title: 'Mal', days: 0 }] });
    expect(res.status).toBe(400);
    expect((await request(ctx.app).get('/api/deadlines')).body.deadlines).toEqual([]);

    const clientMissing = await request(ctx.app)
      .post('/api/deadlines/batch')
      .send({ items: [{ ...term, title: 'Bien' }, { ...term, title: 'Mal', clientId: '00000000-0000-4000-8000-000000000000' }] });
    expect(clientMissing.status).toBe(400);
    expect((await request(ctx.app).get('/api/deadlines')).body.deadlines).toEqual([]);
  });

  it('needs between 1 and 10 items', async () => {
    expect((await request(ctx.app).post('/api/deadlines/batch').send({ items: [] })).status).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ ...term, title: `Plazo ${i}` }));
    expect((await request(ctx.app).post('/api/deadlines/batch').send({ items: eleven })).status).toBe(400);
  });
});

describe('GET /api/deadlines', () => {
  it('lists the soonest first, and filters by status and by client', async () => {
    const client = await createClient('Juan Ejemplo');
    const later = (await create({ ...term, title: 'Más adelante', days: 15 })).body.deadline;
    const sooner = (await create({ ...term, title: 'Primero', days: 3, clientId: client.id })).body.deadline;
    const done = (await create({ ...term, title: 'Ya hecho', days: 1 })).body.deadline;
    await request(ctx.app).patch(`/api/deadlines/${done.id}`).send({ status: 'DONE' });

    const all = await request(ctx.app).get('/api/deadlines');
    expect(all.body.deadlines.map((d: { title: string }) => d.title)).toEqual(['Ya hecho', 'Primero', 'Más adelante']);
    expect(all.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const pending = await request(ctx.app).get('/api/deadlines?status=PENDING');
    expect(pending.body.deadlines.map((d: { id: string }) => d.id)).toEqual([sooner.id, later.id]);

    const fulfilled = await request(ctx.app).get('/api/deadlines?status=DONE');
    expect(fulfilled.body.deadlines.map((d: { id: string }) => d.id)).toEqual([done.id]);

    const ofClient = await request(ctx.app).get(`/api/deadlines?clientId=${client.id}`);
    expect(ofClient.body.deadlines.map((d: { id: string }) => d.id)).toEqual([sooner.id]);

    expect((await request(ctx.app).get('/api/deadlines?status=LATE')).status).toBe(400);
    expect((await request(ctx.app).get('/api/deadlines?clientId=nope')).status).toBe(400);
  });
});

describe('GET /api/deadlines/:id', () => {
  it('returns the deadline with the days that did not count, to check the calculation', async () => {
    const created = (await create({ ...term, title: 'Contestar demanda' })).body.deadline;

    const res = await request(ctx.app).get(`/api/deadlines/${created.id}`);

    expect(res.status).toBe(200);
    expect(res.body.deadline).toMatchObject({ id: created.id, dueDate: '2026-10-16' });
    expect(res.body.calculation.skipped.map((s: { date: string }) => s.date)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12']);
  });

  it('reports a deadline that does not exist', async () => {
    expect((await request(ctx.app).get('/api/deadlines/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(ctx.app).get('/api/deadlines/not-a-uuid')).status).toBe(400);
  });
});

describe('PATCH /api/deadlines/:id', () => {
  it('changes only what it receives', async () => {
    const created = (await create({ ...term, title: 'Contestar', caseReference: 'Expte. 1', notes: 'Pedir prórroga' })).body.deadline;

    const res = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ title: 'Contestar la demanda' });

    expect(res.body.deadline).toMatchObject({
      title: 'Contestar la demanda',
      caseReference: 'Expte. 1',
      notes: 'Pedir prórroga',
      dueDate: '2026-10-16',
    });
  });

  it('calculates the due date again when the term changes', async () => {
    const created = (await create({ ...term, title: 'Contestar' })).body.deadline;
    expect(created.dueDate).toBe('2026-10-16');

    const moreDays = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ days: 15 });
    expect(moreDays.body.deadline.dueDate).toBe('2026-10-30');

    const otherDate = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ notificationDate: '2026-10-09' });
    expect(otherDate.body.deadline.dueDate).toBe('2026-11-02');

    const calendarDays = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ dayType: 'CALENDAR' });
    expect(calendarDays.body.deadline).toMatchObject({ dayType: 'CALENDAR', dueDate: '2026-10-26' });
  });

  it('marks a deadline as fulfilled and reopens it', async () => {
    const created = (await create({ ...term, title: 'Contestar' })).body.deadline;

    const done = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ status: 'DONE' });
    expect(done.body.deadline).toMatchObject({ status: 'DONE', state: 'DONE' });
    expect(done.body.deadline.completedAt).not.toBeNull();

    const reopened = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ status: 'PENDING' });
    expect(reopened.body.deadline).toMatchObject({ status: 'PENDING', completedAt: null });
  });

  it('links and unlinks a client', async () => {
    const client = await createClient('Juan Ejemplo');
    const created = (await create({ ...term, title: 'Contestar' })).body.deadline;

    const linked = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ clientId: client.id });
    expect(linked.body.deadline.client).toEqual({ id: client.id, fullName: 'Juan Ejemplo' });

    const unlinked = await request(ctx.app).patch(`/api/deadlines/${created.id}`).send({ clientId: null });
    expect(unlinked.body.deadline.client).toBeNull();
  });

  it('rejects an empty request, bad data, a missing client and unknown deadlines', async () => {
    const created = (await create({ ...term, title: 'Contestar' })).body.deadline;
    const patch = (id: string, body: object) => request(ctx.app).patch(`/api/deadlines/${id}`).send(body);

    expect((await patch(created.id, {})).status).toBe(400);
    expect((await patch(created.id, { days: 0 })).status).toBe(400);
    expect((await patch(created.id, { title: '' })).status).toBe(400);
    expect((await patch(created.id, { clientId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400);
    expect((await patch('00000000-0000-4000-8000-000000000000', { notes: 'x' })).status).toBe(404);
  });
});

describe('DELETE /api/deadlines/:id', () => {
  it('deletes the deadline', async () => {
    const created = (await create({ ...term, title: 'Contestar' })).body.deadline;

    expect((await request(ctx.app).delete(`/api/deadlines/${created.id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/deadlines/${created.id}`)).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/deadlines/${created.id}`)).status).toBe(404);
  });

  it('survives its client being deleted (the link is cleared)', async () => {
    const client = await createClient('Juan Ejemplo');
    const created = (await create({ ...term, title: 'Contestar', clientId: client.id })).body.deadline;

    await request(ctx.app).delete(`/api/clients/${client.id}`);

    const res = await request(ctx.app).get(`/api/deadlines/${created.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deadline.client).toBeNull();
  });
});
