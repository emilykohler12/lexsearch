import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, toDate, todayInArgentina } from '../../src/modules/calendar/dates.js';
import { createTestApp } from '../helpers/test-app.js';

const ctx = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await ctx.reset();
});

const createDeadline = async (title = 'Contestar demanda') =>
  (
    await request(ctx.app)
      .post('/api/deadlines')
      .send({ title, notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' })
  ).body.deadline as { id: string; dueDate: string };

/** Puts the due date where the test needs it (relative to today), whatever the calendar says. */
const dueIn = (id: string, days: number) =>
  ctx.db.deadline.update({ where: { id }, data: { dueDate: toDate(addDays(todayInArgentina(), days)) } });

const warningsOf = (deadlineId: string) =>
  ctx.db.notification.findMany({ where: { deadlineId }, orderBy: { createdAt: 'asc' } });

describe('DeadlineWatcher', () => {
  // The deadline below is due on Friday 2026-10-16.
  const check = (date: string) => ctx.watcher.check(new Date(`${date}T15:00:00Z`));

  it('creates one warning per stage as the due date gets closer, and retires the older ones', async () => {
    const deadline = await createDeadline();
    expect(deadline.dueDate).toBe('2026-10-16');

    expect(await check('2026-10-12')).toBe(0); // 4 days left: too early
    expect(await check('2026-10-13')).toBe(1); // 3 days left
    expect(await check('2026-10-13')).toBe(0); // already warned: running it again changes nothing
    expect(await check('2026-10-15')).toBe(1); // tomorrow
    expect(await check('2026-10-16')).toBe(1); // today
    expect(await check('2026-10-19')).toBe(1); // overdue (it's Monday)

    const warnings = await warningsOf(deadline.id);
    expect(warnings.map((w) => [w.kind, w.message, w.readAt !== null])).toEqual([
      ['DEADLINE_SOON_3', 'Vence en 3 días (vie 16/10/2026)', true],
      ['DEADLINE_SOON_1', 'Vence mañana (vie 16/10/2026)', true],
      ['DEADLINE_TODAY', 'Vence hoy (vie 16/10/2026)', true],
      ['DEADLINE_OVERDUE', 'Venció hace 3 días (vie 16/10/2026)', false],
    ]);
    expect(warnings.every((w) => w.title === 'Contestar demanda')).toBe(true);
  });

  it('uses the date in Argentina, not the server clock', async () => {
    const deadline = await createDeadline();
    // 01:00 UTC on the 14th is still the 13th in Buenos Aires: three days left, not two.
    await ctx.watcher.check(new Date('2026-10-14T01:00:00Z'));
    const [warning] = await warningsOf(deadline.id);
    expect(warning!.message).toBe('Vence en 3 días (vie 16/10/2026)');
  });

  it('skips the deadlines that are fulfilled or far away', async () => {
    const far = await createDeadline('Lejano');
    const done = await createDeadline('Hecho');
    await request(ctx.app).patch(`/api/deadlines/${done.id}`).send({ status: 'DONE' });

    expect(await check('2026-10-12')).toBe(0);
    expect(await check('2026-10-19')).toBe(1); // only the pending one is overdue
    expect(await warningsOf(done.id)).toEqual([]);
    expect((await warningsOf(far.id)).map((w) => w.kind)).toEqual(['DEADLINE_OVERDUE']);
  });
});

describe('GET /api/notifications', () => {
  it('warns about what is due, even if the hourly check did not run', async () => {
    const deadline = await createDeadline('Contestar demanda');
    await dueIn(deadline.id, 1);

    const res = await request(ctx.app).get('/api/notifications');

    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0]).toMatchObject({
      kind: 'DEADLINE_SOON_1',
      deadlineId: deadline.id,
      title: 'Contestar demanda',
    });
    expect(res.body.notifications[0].message).toMatch(/^Vence mañana \(/);
    expect(res.body.notifications[0]).not.toHaveProperty('readAt');
  });

  it('says nothing about deadlines that are not near', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 10);
    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toEqual([]);
  });

  it('lists the newest first', async () => {
    const first = await createDeadline('Primero');
    await dueIn(first.id, 0);
    await request(ctx.app).get('/api/notifications');
    const second = await createDeadline('Segundo');
    await dueIn(second.id, -2);

    const res = await request(ctx.app).get('/api/notifications');
    expect(res.body.notifications.map((n: { title: string }) => n.title)).toEqual(['Segundo', 'Primero']);
    expect(res.body.notifications[0].message).toMatch(/^Venció hace 2 días/);
  });
});

describe('reading warnings', () => {
  it('marks one as read, then all', async () => {
    const a = await createDeadline('A');
    const b = await createDeadline('B');
    await dueIn(a.id, 0);
    await dueIn(b.id, 0);
    const { notifications } = (await request(ctx.app).get('/api/notifications')).body as {
      notifications: Array<{ id: string }>;
    };
    expect(notifications).toHaveLength(2);

    expect((await request(ctx.app).post(`/api/notifications/${notifications[0]!.id}/read`)).status).toBe(204);
    // Reading one twice is harmless.
    expect((await request(ctx.app).post(`/api/notifications/${notifications[0]!.id}/read`)).status).toBe(204);
    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toHaveLength(1);

    expect((await request(ctx.app).post('/api/notifications/read-all')).status).toBe(204);
    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toEqual([]);
  });

  it('does not bring back a warning the lawyer already read', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 0);
    const [first] = (await request(ctx.app).get('/api/notifications')).body.notifications;
    await request(ctx.app).post(`/api/notifications/${first.id}/read`);

    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toEqual([]);
  });

  it('reports a warning that does not exist', async () => {
    expect((await request(ctx.app).post('/api/notifications/00000000-0000-4000-8000-000000000000/read')).status).toBe(404);
    expect((await request(ctx.app).post('/api/notifications/not-a-uuid/read')).status).toBe(400);
  });
});

describe('when a deadline changes', () => {
  it('clears its warnings when it is fulfilled', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 1);
    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toHaveLength(1);

    await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ status: 'DONE' });

    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toEqual([]);
    expect(await warningsOf(deadline.id)).toEqual([]);
  });

  it('clears them when its due date moves, and warns again when the new date is near', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 1);
    await request(ctx.app).get('/api/notifications');
    expect(await warningsOf(deadline.id)).toHaveLength(1);

    // A new term gives it a new due date (far in the future): the old warning no longer holds.
    await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ notificationDate: '2030-01-10' });
    expect(await warningsOf(deadline.id)).toEqual([]);
    expect((await request(ctx.app).get('/api/notifications')).body.notifications).toEqual([]);
  });

  it('keeps its warnings when only the notes change', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 1);
    await request(ctx.app).get('/api/notifications');

    await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ notes: 'Llamar al cliente' });

    expect(await warningsOf(deadline.id)).toHaveLength(1);
  });

  it('removes its warnings when it is deleted', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 0);
    await request(ctx.app).get('/api/notifications');

    await request(ctx.app).delete(`/api/deadlines/${deadline.id}`);

    expect(await ctx.db.notification.count()).toBe(0);
  });

  it('warns again if a fulfilled deadline is reopened', async () => {
    const deadline = await createDeadline();
    await dueIn(deadline.id, 0);
    await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ status: 'DONE' });
    await request(ctx.app).patch(`/api/deadlines/${deadline.id}`).send({ status: 'PENDING' });

    const res = await request(ctx.app).get('/api/notifications');
    expect(res.body.notifications).toHaveLength(1);
    expect(res.body.notifications[0].kind).toBe('DEADLINE_TODAY');
  });
});
