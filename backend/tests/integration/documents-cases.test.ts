import { readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../helpers/test-app.js';

const ctx = await createTestApp();
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const NOT_A_RECORD = '00000000-0000-4000-8000-000000000000';

const newCase = async (title = 'Ramírez c/ Transportes') =>
  (await request(ctx.app).post('/api/cases').send({ title })).body.case as { id: string };

const upload = (name: string, text: string, fields: Record<string, string> = {}) => {
  let req = request(ctx.app).post('/api/documents');
  for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
  return req.attach('files', Buffer.from(text), name);
};

describe('documents of an expediente', () => {
  it('uploads a document to an expediente as a prueba and lists it by expediente', async () => {
    const mine = await newCase();
    const other = await newCase('Otro');

    const res = await upload('Declaración de Juan.txt', 'Declaración testimonial de Juan Ejemplo sobre la entrega de las llaves.', {
      category: 'PRUEBA',
      caseId: mine.id,
    });
    await upload('Contrato de otro.txt', 'Contrato de locación de otro expediente, con otro texto.', { caseId: other.id });
    await upload('Ley suelta.txt', 'Texto de una ley de la biblioteca general que no es de ningún expediente.');
    await ctx.queue.idle();

    expect(res.status).toBe(202);
    expect(res.body.results[0].document).toMatchObject({ category: 'PRUEBA', caseId: mine.id });

    const ofMine = await request(ctx.app).get('/api/documents').query({ caseId: mine.id });
    expect(ofMine.body.documents.map((d: { title: string }) => d.title)).toEqual(['Declaración de Juan']);
    expect(ofMine.body.documents[0]).toMatchObject({ category: 'PRUEBA', caseId: mine.id, status: 'READY' });

    const all = await request(ctx.app).get('/api/documents');
    expect(all.body.documents).toHaveLength(3);
    expect(all.body.documents.filter((d: { caseId: string | null }) => d.caseId === null)).toHaveLength(1);
    expect((await request(ctx.app).get('/api/documents').query({ caseId: 'no-es-un-id' })).status).toBe(400);
  });

  it('rejects an expediente that does not exist and does not keep the file', async () => {
    const res = await upload('Declaración.txt', 'Texto de una declaración que no va a ninguna parte.', { caseId: NOT_A_RECORD });

    expect(res.status).toBe(400);
    expect(await ctx.db.document.count()).toBe(0);
    expect(await readdir(ctx.storage.tmpDir)).toEqual([]);
  });

  it('links a document that was already in the library when it is uploaded to an expediente', async () => {
    const mine = await newCase();
    const other = await newCase('Otro');
    const text = 'Contrato de locación firmado por las partes, con su cláusula de entrega.';
    await upload('contrato.txt', text);

    const again = await upload('contrato copia.txt', text, { caseId: mine.id });
    expect(again.body.results[0]).toMatchObject({ status: 'duplicate' });
    expect(again.body.results[0].document.caseId).toBe(mine.id);
    expect(await ctx.db.document.count()).toBe(1);

    // One that already belongs to an expediente stays where it is.
    const elsewhere = await upload('contrato otra vez.txt', text, { caseId: other.id });
    expect(elsewhere.body.results[0].document.caseId).toBe(mine.id);
  });

  it('links and unlinks a document of the library', async () => {
    const mine = await newCase();
    const created = await upload('Recibo.txt', 'Recibo de pago del alquiler de marzo por un monto de pesos.');
    const { id } = created.body.results[0].document;
    expect(created.body.results[0].document.caseId).toBeNull();

    const linked = await request(ctx.app).patch(`/api/documents/${id}`).send({ caseId: mine.id, category: 'PRUEBA' });
    expect(linked.status).toBe(200);
    expect(linked.body.document).toMatchObject({ caseId: mine.id, category: 'PRUEBA' });

    const unlinked = await request(ctx.app).patch(`/api/documents/${id}`).send({ caseId: null });
    expect(unlinked.body.document.caseId).toBeNull();
    expect(unlinked.body.document.category).toBe('PRUEBA');

    expect((await request(ctx.app).patch(`/api/documents/${id}`).send({ caseId: NOT_A_RECORD })).status).toBe(400);
    expect((await request(ctx.app).patch(`/api/documents/${id}`).send({})).status).toBe(400);
  });

  it('keeps the documents when the expediente is deleted', async () => {
    const mine = await newCase();
    const created = await upload('Declaración.txt', 'Declaración testimonial sobre los hechos del expediente.', { caseId: mine.id });
    const { id } = created.body.results[0].document;

    await request(ctx.app).delete(`/api/cases/${mine.id}`);

    const kept = await request(ctx.app).get(`/api/documents/${id}`);
    expect(kept.status).toBe(200);
    expect(kept.body.document.caseId).toBeNull();
  });
});
