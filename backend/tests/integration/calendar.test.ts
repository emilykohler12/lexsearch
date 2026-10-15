import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { todayInArgentina } from '../../src/modules/calendar/dates.js';
import { createTestApp } from '../helpers/test-app.js';

const ctx = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const addDay = (body: object) => request(ctx.app).post('/api/calendar/non-working-days').send(body);
const createDeadline = async (body: object) =>
  (await request(ctx.app).post('/api/deadlines').send(body)).body.deadline as { id: string; dueDate: string };
const dueDateOf = async (id: string) => (await request(ctx.app).get(`/api/deadlines/${id}`)).body.deadline.dueDate as string;

describe('GET /api/calendar', () => {
  it('gives the national holidays of a year, and no days of the lawyer at first', async () => {
    const res = await request(ctx.app).get('/api/calendar?year=2026');

    expect(res.status).toBe(200);
    expect(res.body.year).toBe(2026);
    expect(res.body.holidays).toHaveLength(16);
    expect(res.body.holidays[0]).toEqual({ date: '2026-01-01', name: 'Año Nuevo' });
    expect(res.body.holidays.map((h: { date: string }) => h.date)).toContain('2026-11-23');
    expect(res.body.customDays).toEqual([]);
  });

  it('defaults to the current year', async () => {
    const res = await request(ctx.app).get('/api/calendar');
    expect(res.body.year).toBe(Number(todayInArgentina().slice(0, 4)));
  });

  it('rejects a year that makes no sense', async () => {
    expect((await request(ctx.app).get('/api/calendar?year=1900')).status).toBe(400);
    expect((await request(ctx.app).get('/api/calendar?year=abc')).status).toBe(400);
  });
});

describe('non-working days of the lawyer', () => {
  it('adds a single day and a range, edits one and removes one', async () => {
    const single = await addDay({ startDate: '2026-10-13', label: 'Asueto judicial' });
    expect(single.status).toBe(201);
    // A day with no end date is just that day.
    expect(single.body.nonWorkingDay).toMatchObject({ startDate: '2026-10-13', endDate: '2026-10-13', label: 'Asueto judicial' });

    const range = await addDay({ startDate: '2026-07-20', endDate: '2026-07-31', label: 'Feria judicial de invierno' });
    expect(range.status).toBe(201);

    const list = await request(ctx.app).get('/api/calendar?year=2026');
    expect(list.body.customDays.map((d: { label: string }) => d.label)).toEqual([
      'Feria judicial de invierno',
      'Asueto judicial',
    ]);

    const edited = await request(ctx.app)
      .put(`/api/calendar/non-working-days/${single.body.nonWorkingDay.id}`)
      .send({ startDate: '2026-10-14', label: 'Asueto corregido' });
    expect(edited.body.nonWorkingDay).toMatchObject({ startDate: '2026-10-14', endDate: '2026-10-14', label: 'Asueto corregido' });

    expect((await request(ctx.app).delete(`/api/calendar/non-working-days/${range.body.nonWorkingDay.id}`)).status).toBe(204);
    const after = await request(ctx.app).get('/api/calendar?year=2026');
    expect(after.body.customDays).toHaveLength(1);
  });

  it('shows a day under every year it touches, and only those', async () => {
    await addDay({ startDate: '2026-12-28', endDate: '2027-01-10', label: 'Receso de fin de año' });
    await addDay({ startDate: '2025-03-03', label: 'Del año pasado' });

    const year2026 = await request(ctx.app).get('/api/calendar?year=2026');
    const year2027 = await request(ctx.app).get('/api/calendar?year=2027');
    expect(year2026.body.customDays.map((d: { label: string }) => d.label)).toEqual(['Receso de fin de año']);
    expect(year2027.body.customDays.map((d: { label: string }) => d.label)).toEqual(['Receso de fin de año']);
  });

  it('validates what it gets', async () => {
    expect((await addDay({ startDate: '2026-10-13' })).status).toBe(400); // no label
    expect((await addDay({ startDate: '2026-10-13', label: '   ' })).status).toBe(400);
    expect((await addDay({ startDate: '2026-02-30', label: 'No existe' })).status).toBe(400);
    expect((await addDay({ startDate: '13/10/2026', label: 'Mal formato' })).status).toBe(400);
    expect((await addDay({ startDate: '2026-10-14', endDate: '2026-10-13', label: 'Al revés' })).status).toBe(400);
    expect((await addDay({ startDate: '2026-01-01', endDate: '2027-06-01', label: 'Demasiado largo' })).status).toBe(400);
  });

  it('reports a day that does not exist', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await request(ctx.app).put(`/api/calendar/non-working-days/${id}`).send({ startDate: '2026-10-13', label: 'x' })).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/calendar/non-working-days/${id}`)).status).toBe(404);
  });

  it('moves the due date of pending deadlines when days are added or removed', async () => {
    const pending = await createDeadline({ title: 'Contestar', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' });
    const done = await createDeadline({ title: 'Ya cumplido', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' });
    await request(ctx.app).patch(`/api/deadlines/${done.id}`).send({ status: 'DONE' });
    expect(pending.dueDate).toBe('2026-10-16');

    // Two working days of recess in the middle of the term: it ends two working days later.
    const asueto = await addDay({ startDate: '2026-10-13', endDate: '2026-10-14', label: 'Asueto' });
    expect(await dueDateOf(pending.id)).toBe('2026-10-20');
    // What is already fulfilled is history: it doesn't move.
    expect(await dueDateOf(done.id)).toBe('2026-10-16');

    await request(ctx.app).delete(`/api/calendar/non-working-days/${asueto.body.nonWorkingDay.id}`);
    expect(await dueDateOf(pending.id)).toBe('2026-10-16');
  });
});
