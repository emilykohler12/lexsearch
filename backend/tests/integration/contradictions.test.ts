import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const ctx = await createTestApp();
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000';

const newCase = async (title = 'Ramírez c/ Transportes') =>
  (await request(ctx.app).post('/api/cases').send({ title })).body.case as { id: string };

async function uploadDocument(caseId: string, name: string, text: string): Promise<{ id: string; title: string }> {
  const res = await request(ctx.app)
    .post('/api/documents')
    .field('category', 'PRUEBA')
    .field('caseId', caseId)
    .attach('files', Buffer.from(text), name);
  await ctx.queue.idle();
  return res.body.results[0].document;
}

const statement = (document: { id: string; title: string }, quote: string, quoteVerified = true) => ({
  documentId: document.id,
  documentTitle: document.title,
  quote,
  quoteVerified,
});

interface Doc {
  id: string;
  title: string;
}

const finding = (a: Doc, b: Doc, overrides: object = {}) => ({
  kind: 'MONTO',
  confidence: 'DIRECTA',
  title: 'Monto del alquiler mensual',
  explanation: 'El contrato dice $180.000; la testigo, ciento cincuenta mil.',
  statements: [statement(a, 'el alquiler mensual es de $180.000'), statement(b, 'el alquiler era de ciento cincuenta mil pesos')],
  ...overrides,
});

const save = (caseId: string, items: object[]) => request(ctx.app).post(`/api/cases/${caseId}/contradictions`).send({ items });
const list = (caseId: string) => request(ctx.app).get(`/api/cases/${caseId}/contradictions`);

async function twoDocuments(caseId: string): Promise<[Doc, Doc]> {
  const a = await uploadDocument(caseId, 'Contrato de locación.txt', 'CLÁUSULA TERCERA: el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes.');
  const b = await uploadDocument(caseId, 'Declaración de Laura.txt', 'Que sabe que el alquiler era de ciento cincuenta mil pesos por mes porque él se lo comentó.');
  return [a, b];
}

describe('POST /api/cases/:id/contradictions', () => {
  it('saves the findings the lawyer confirmed, together and in order', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);

    const res = await save(id, [
      finding(a, b, { title: 'Primera', confidence: 'DIRECTA' }),
      finding(a, b, { title: 'Segunda', kind: 'FECHA', confidence: 'POSIBLE' }),
      finding(a, b, { title: 'Tercera', kind: 'DECLARACION' }),
    ]);

    expect(res.status).toBe(201);
    expect(res.body.contradictions.map((c: { title: string }) => c.title)).toEqual(['Primera', 'Segunda', 'Tercera']);
    expect(res.body.contradictions[0]).toMatchObject({
      caseId: id,
      kind: 'MONTO',
      confidence: 'DIRECTA',
      explanation: 'El contrato dice $180.000; la testigo, ciento cincuenta mil.',
      note: '',
    });
    expect(res.body.contradictions[0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.contradictions[0].statements[0]).toEqual({
      documentId: a.id,
      documentTitle: a.title,
      quote: 'el alquiler mensual es de $180.000',
      quoteVerified: true,
      document: { id: a.id, title: a.title },
    });

    const saved = await list(id);
    expect(saved.body.contradictions.map((c: { title: string }) => c.title)).toEqual(['Primera', 'Segunda', 'Tercera']);
  });

  it('lists the findings in the order they were confirmed, one reading after the other', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);

    await save(id, [finding(a, b, { title: 'De la primera lectura A' }), finding(a, b, { title: 'De la primera lectura B' })]);
    await save(id, [finding(a, b, { title: 'De la segunda lectura' })]);

    const titles = (await list(id)).body.contradictions.map((c: { title: string }) => c.title);
    expect(titles).toEqual(['De la primera lectura A', 'De la primera lectura B', 'De la segunda lectura']);
  });

  it('rejects bad data and an expediente that does not exist, and saves nothing', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);

    expect((await save(id, [])).status).toBe(400);
    expect((await save(id, [finding(a, b, { statements: [statement(a, 'una sola parte')] })])).status).toBe(400);
    expect((await save(id, [finding(a, b, { kind: 'OPINION' })])).status).toBe(400);
    expect((await save(id, [finding(a, b, { title: '' })])).status).toBe(400);
    // One bad one among good ones: none is saved.
    expect((await save(id, [finding(a, b), finding(a, b, { confidence: 'ALTA' })])).status).toBe(400);
    expect((await save(NOT_A_RECORD, [finding(a, b)])).status).toBe(404);
    expect((await request(ctx.app).post('/api/cases/no-es-un-id/contradictions').send({ items: [finding(a, b)] })).status).toBe(400);

    expect(await ctx.db.contradiction.count()).toBe(0);
  });
});

describe('the documents behind a finding', () => {
  it('shows a renamed document with its new name, and keeps the name it had when it was saved', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);
    await save(id, [finding(a, b)]);

    await request(ctx.app).patch(`/api/documents/${a.id}`).send({ title: 'Contrato (versión firmada)' });

    const [first] = (await list(id)).body.contradictions;
    expect(first.statements[0]).toMatchObject({
      documentTitle: a.title,
      document: { id: a.id, title: 'Contrato (versión firmada)' },
    });
  });

  it('keeps the finding, with the document marked as gone, when a document is deleted', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);
    await save(id, [finding(a, b)]);

    await request(ctx.app).delete(`/api/documents/${b.id}`);

    const [first] = (await list(id)).body.contradictions;
    expect(first.statements[1]).toMatchObject({ documentId: b.id, documentTitle: b.title, document: null });
    expect(first.statements[0].document).toEqual({ id: a.id, title: a.title });
  });

  it('deletes the findings with the expediente', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);
    await save(id, [finding(a, b)]);

    await request(ctx.app).delete(`/api/cases/${id}`);

    expect(await ctx.db.contradiction.count()).toBe(0);
    expect((await list(id)).status).toBe(404);
  });
});

describe('PATCH and DELETE /api/cases/:id/contradictions/:contradictionId', () => {
  it('saves the lawyer notes on a finding', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);
    const [created] = (await save(id, [finding(a, b)])).body.contradictions;

    const res = await request(ctx.app).patch(`/api/cases/${id}/contradictions/${created.id}`).send({ note: '  Preguntarle a la testigo cómo lo supo.  ' });

    expect(res.status).toBe(200);
    expect(res.body.contradiction).toMatchObject({ id: created.id, note: 'Preguntarle a la testigo cómo lo supo.', title: created.title });
    expect((await list(id)).body.contradictions[0].note).toBe('Preguntarle a la testigo cómo lo supo.');

    const cleared = await request(ctx.app).patch(`/api/cases/${id}/contradictions/${created.id}`).send({ note: '' });
    expect(cleared.body.contradiction.note).toBe('');
  });

  it('deletes a finding', async () => {
    const { id } = await newCase();
    const [a, b] = await twoDocuments(id);
    const [first, second] = (await save(id, [finding(a, b, { title: 'Una' }), finding(a, b, { title: 'Otra' })])).body.contradictions;

    const res = await request(ctx.app).delete(`/api/cases/${id}/contradictions/${first.id}`);

    expect(res.status).toBe(204);
    expect((await list(id)).body.contradictions.map((c: { id: string }) => c.id)).toEqual([second.id]);
    expect((await request(ctx.app).delete(`/api/cases/${id}/contradictions/${first.id}`)).status).toBe(404);
  });

  it('does not touch a finding through another expediente, and validates the note', async () => {
    const mine = await newCase();
    const other = await newCase('Otro');
    const [a, b] = await twoDocuments(mine.id);
    const [created] = (await save(mine.id, [finding(a, b)])).body.contradictions;

    expect((await request(ctx.app).patch(`/api/cases/${other.id}/contradictions/${created.id}`).send({ note: 'x' })).status).toBe(404);
    expect((await request(ctx.app).delete(`/api/cases/${other.id}/contradictions/${created.id}`)).status).toBe(404);
    expect(await ctx.db.contradiction.count()).toBe(1);

    const patch = (body: object) => request(ctx.app).patch(`/api/cases/${mine.id}/contradictions/${created.id}`).send(body);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ note: 'x'.repeat(4_001) })).status).toBe(400);
  });
});
