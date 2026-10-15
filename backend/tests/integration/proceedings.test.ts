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

const newCase = async (title = 'Pérez c/ Gómez') =>
  (await request(ctx.app).post('/api/cases').send({ title })).body.case as { id: string };
const addProceeding = (caseId: string, body: object) => request(ctx.app).post(`/api/cases/${caseId}/proceedings`).send(body);
const addBatch = (caseId: string, items: object[]) => request(ctx.app).post(`/api/cases/${caseId}/proceedings/batch`).send({ items });
const timeline = (caseId: string) => request(ctx.app).get(`/api/cases/${caseId}/timeline`);
const titles = (items: Array<{ title: string }>) => items.map((item) => item.title);

async function uploadDocument(name: string, content: string): Promise<{ id: string; title: string }> {
  const res = await request(ctx.app).post('/api/documents').attach('files', Buffer.from(content), name);
  await ctx.queue.idle();
  return res.body.results[0].document;
}

describe('POST /api/cases/:id/proceedings', () => {
  it('adds an actuación to the expediente', async () => {
    const { id } = await newCase();

    const res = await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' });

    expect(res.status).toBe(201);
    expect(res.body.proceeding).toMatchObject({
      caseId: id,
      date: '2025-03-12',
      kind: 'ESCRITO',
      title: 'Demanda',
      description: '',
      position: 1,
      source: 'MANUAL',
      sourceQuote: '',
      document: null,
    });
    expect(res.body.proceeding.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('puts the actuaciones of the same day one after the other', async () => {
    const { id } = await newCase();
    await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Primera' });
    await addProceeding(id, { date: '2025-03-12', kind: 'RESOLUCION', title: 'Segunda' });
    await addProceeding(id, { date: '2025-03-11', kind: 'OTRO', title: 'Un día antes' });

    const { items } = (await timeline(id)).body;

    expect(titles(items)).toEqual(['Un día antes', 'Primera', 'Segunda']);
  });

  it('rejects bad data, an expediente that does not exist and a document that does not exist', async () => {
    const { id } = await newCase();
    const valid = { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' };

    expect((await addProceeding(id, { ...valid, date: '2025-02-30' })).status).toBe(400);
    expect((await addProceeding(id, { ...valid, date: '12/03/2025' })).status).toBe(400);
    expect((await addProceeding(id, { ...valid, kind: 'CARTA' })).status).toBe(400);
    expect((await addProceeding(id, { ...valid, title: '' })).status).toBe(400);
    expect((await addProceeding(id, {})).status).toBe(400);
    expect((await addProceeding(id, { ...valid, documentId: NOT_A_RECORD })).status).toBe(400);
    expect((await addProceeding(NOT_A_RECORD, valid)).status).toBe(404);
    expect(await ctx.db.proceeding.count()).toBe(0);
  });

  it('links a document of the library and keeps the actuación if the document is deleted', async () => {
    const { id } = await newCase();
    const document = await uploadDocument('escrito.txt', 'Escrito de demanda por daños y perjuicios.');

    const res = await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda', documentId: document.id });
    expect(res.status).toBe(201);
    expect(res.body.proceeding.document).toEqual({ id: document.id, title: document.title });

    await request(ctx.app).delete(`/api/documents/${document.id}`);
    const { items } = (await timeline(id)).body;
    expect(items).toHaveLength(1);
    expect(items[0].document).toBeNull();
  });
});

describe('POST /api/cases/:id/proceedings/batch', () => {
  it('saves the actuaciones of one reading together, keeping their order within a day', async () => {
    const { id } = await newCase();

    const res = await addBatch(id, [
      { date: '2025-03-14', kind: 'RESOLUCION', title: 'Traslado', source: 'AI', sourceQuote: '14/03/2025 Providencia' },
      { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda B', source: 'AI' },
      { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda A', source: 'AI' },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.proceedings).toHaveLength(3);
    const { items } = (await timeline(id)).body;
    expect(titles(items)).toEqual(['Demanda B', 'Demanda A', 'Traslado']);
    expect(items[2]).toMatchObject({ source: 'AI', sourceQuote: '14/03/2025 Providencia' });
  });

  it('saves all of them or none', async () => {
    const { id } = await newCase();

    const res = await addBatch(id, [
      { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' },
      { date: '2025-03-14', kind: 'RESOLUCION', title: 'Traslado', documentId: NOT_A_RECORD },
    ]);

    expect(res.status).toBe(400);
    expect(await ctx.db.proceeding.count()).toBe(0);
  });

  it('puts the new ones after the ones the day already had', async () => {
    const { id } = await newCase();
    await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Ya estaba' });

    await addBatch(id, [
      { date: '2025-03-12', kind: 'RESOLUCION', title: 'Nueva 1' },
      { date: '2025-03-12', kind: 'RESOLUCION', title: 'Nueva 2' },
    ]);

    expect(titles((await timeline(id)).body.items)).toEqual(['Ya estaba', 'Nueva 1', 'Nueva 2']);
  });

  it('validates the batch', async () => {
    const { id } = await newCase();
    expect((await addBatch(id, [])).status).toBe(400);
    expect((await addBatch(id, [{ date: 'ayer', kind: 'ESCRITO', title: 'x' }])).status).toBe(400);
    expect((await addBatch(NOT_A_RECORD, [{ date: '2025-03-12', kind: 'ESCRITO', title: 'x' }])).status).toBe(404);
  });
});

describe('GET /api/cases/:id/timeline', () => {
  it('puts actuaciones and deadlines in one list, oldest first', async () => {
    const { id } = await newCase();
    await addBatch(id, [
      { date: '2026-10-05', kind: 'ESCRITO', title: 'Contestación' },
      { date: '2026-09-01', kind: 'ESCRITO', title: 'Demanda' },
      { date: '2026-10-30', kind: 'AUDIENCIA', title: 'Audiencia preliminar' },
    ]);
    // Notified on 8/10, 5 business days: ends on Friday 16/10, between the contestación and the audiencia.
    const deadline = (
      await request(ctx.app)
        .post('/api/deadlines')
        .send({ title: 'Ofrecer prueba', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS', caseId: id })
    ).body.deadline;
    // A deadline of another expediente does not show up here.
    const other = await newCase('Otro');
    await request(ctx.app)
      .post('/api/deadlines')
      .send({ title: 'De otro', notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS', caseId: other.id });

    const res = await timeline(id);

    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({ id, title: 'Pérez c/ Gómez', proceedingCount: 3 });
    expect(res.body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.items.map((item: { type: string; title: string }) => `${item.type}:${item.title}`)).toEqual([
      'PROCEEDING:Demanda',
      'PROCEEDING:Contestación',
      'DEADLINE:Ofrecer prueba',
      'PROCEEDING:Audiencia preliminar',
    ]);
    expect(res.body.items[2]).toMatchObject({
      id: deadline.id,
      date: '2026-10-16',
      status: 'PENDING',
      notificationDate: '2026-10-08',
      days: 5,
      dayType: 'BUSINESS',
    });
    expect(typeof res.body.items[2].daysLeft).toBe('number');
    expect(typeof res.body.items[2].state).toBe('string');
  });

  it('is empty for a new expediente, and 404 for one that does not exist', async () => {
    const { id } = await newCase();
    expect((await timeline(id)).body.items).toEqual([]);
    expect((await timeline(NOT_A_RECORD)).status).toBe(404);
    expect((await timeline('no-es-un-id')).status).toBe(400);
  });
});

describe('PATCH and DELETE /api/cases/:id/proceedings/:proceedingId', () => {
  it('changes an actuación and the timeline follows its new date', async () => {
    const { id } = await newCase();
    const first = (await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).body.proceeding;
    await addProceeding(id, { date: '2025-04-01', kind: 'ESCRITO', title: 'Contestación' });

    const res = await request(ctx.app)
      .patch(`/api/cases/${id}/proceedings/${first.id}`)
      .send({ date: '2025-05-20', kind: 'OTRO', description: 'Corregida' });

    expect(res.status).toBe(200);
    expect(res.body.proceeding).toMatchObject({ date: '2025-05-20', kind: 'OTRO', title: 'Demanda', description: 'Corregida' });
    expect(titles((await timeline(id)).body.items)).toEqual(['Contestación', 'Demanda']);
  });

  it('links and unlinks a document', async () => {
    const { id } = await newCase();
    const proceeding = (await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).body.proceeding;
    const document = await uploadDocument('escrito.txt', 'Escrito de demanda por daños y perjuicios.');

    const linked = await request(ctx.app).patch(`/api/cases/${id}/proceedings/${proceeding.id}`).send({ documentId: document.id });
    expect(linked.body.proceeding.document).toEqual({ id: document.id, title: document.title });

    const unlinked = await request(ctx.app).patch(`/api/cases/${id}/proceedings/${proceeding.id}`).send({ documentId: null });
    expect(unlinked.body.proceeding.document).toBeNull();

    const unknown = await request(ctx.app).patch(`/api/cases/${id}/proceedings/${proceeding.id}`).send({ documentId: NOT_A_RECORD });
    expect(unknown.status).toBe(400);
  });

  it('deletes an actuación', async () => {
    const { id } = await newCase();
    const proceeding = (await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).body.proceeding;

    const res = await request(ctx.app).delete(`/api/cases/${id}/proceedings/${proceeding.id}`);

    expect(res.status).toBe(204);
    expect((await timeline(id)).body.items).toEqual([]);
    expect((await request(ctx.app).delete(`/api/cases/${id}/proceedings/${proceeding.id}`)).status).toBe(404);
  });

  it('does not touch an actuación through another expediente', async () => {
    const mine = await newCase('Mío');
    const other = await newCase('Otro');
    const proceeding = (await addProceeding(mine.id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).body.proceeding;

    expect((await request(ctx.app).patch(`/api/cases/${other.id}/proceedings/${proceeding.id}`).send({ title: 'x' })).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/cases/${other.id}/proceedings/${proceeding.id}`)).status).toBe(404);
    expect(await ctx.db.proceeding.count()).toBe(1);
  });

  it('rejects an empty change and bad data', async () => {
    const { id } = await newCase();
    const proceeding = (await addProceeding(id, { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).body.proceeding;
    const patch = (body: object) => request(ctx.app).patch(`/api/cases/${id}/proceedings/${proceeding.id}`).send(body);

    expect((await patch({})).status).toBe(400);
    expect((await patch({ date: '2025-13-01' })).status).toBe(400);
    expect((await patch({ kind: 'CARTA' })).status).toBe(400);
    expect((await patch({ title: '' })).status).toBe(400);
  });
});
