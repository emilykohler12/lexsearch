import { existsSync } from 'node:fs';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, makePdf } from '../helpers/test-app.js';

const ctx = await createTestApp();
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const LCT_PAGES = [
  'LEY DE CONTRATO DE TRABAJO\nARTÍCULO 231.- Plazos. El contrato de trabajo no podrá ser disuelto por voluntad de una de las partes sin previo aviso.',
  'ARTÍCULO 245.- Indemnización por antigüedad o despido. En los casos de despido dispuesto por el empleador sin justa causa, habiendo o no mediado preaviso, éste deberá abonar al trabajador una indemnización equivalente a UN (1) mes de sueldo por cada año de servicio.',
];

async function uploadPdf(name = 'Ley_20744.pdf', pages = LCT_PAGES, category = 'LEGISLACION') {
  return request(ctx.app)
    .post('/api/documents')
    .field('category', category)
    .attach('files', await makePdf(pages), name);
}

describe('documents API', () => {
  it('uploads a PDF and indexes it in the background', async () => {
    const res = await uploadPdf();
    expect(res.status).toBe(202);
    expect(res.body.results).toHaveLength(1);
    const [result] = res.body.results;
    expect(result).toMatchObject({ status: 'created', originalName: 'Ley_20744.pdf' });
    expect(result.document).toMatchObject({ title: 'Ley 20744', category: 'LEGISLACION' });
    expect(result.document).not.toHaveProperty('storagePath');

    await ctx.queue.idle();
    const detail = await request(ctx.app).get(`/api/documents/${result.document.id}`);
    expect(detail.body.document).toMatchObject({ status: 'READY', pageCount: 2, errorMessage: null });
    expect(detail.body.document.chunkCount).toBeGreaterThan(0);
  });

  it('detects duplicates by content, not by name', async () => {
    await uploadPdf('original.pdf');
    const res = await uploadPdf('copia con otro nombre.pdf');
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ status: 'duplicate' });

    const list = await request(ctx.app).get('/api/documents');
    expect(list.body.documents).toHaveLength(1);
  });

  it('rejects unsupported or disguised files with a clear message', async () => {
    const res = await request(ctx.app)
      .post('/api/documents')
      .attach('files', Buffer.from('MZ binary'), 'programa.pdf')
      .attach('files', Buffer.from('x'), 'viejo.doc');

    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([
      { status: 'rejected', originalName: 'programa.pdf', message: expect.stringMatching(/no coincide/) },
      { status: 'rejected', originalName: 'viejo.doc', message: expect.stringMatching(/\.docx o PDF/) },
    ]);
  });

  it('keeps accented file names and indexes plain text files', async () => {
    const res = await request(ctx.app)
      .post('/api/documents')
      .field('title', 'Notas de la contestación')
      .attach('files', Buffer.from('Notas sobre la contestación de demanda.\n\nPlazo de quince días.'), 'Contestación.txt');

    expect(res.body.results[0]).toMatchObject({ status: 'created', originalName: 'Contestación.txt' });
    expect(res.body.results[0].document.title).toBe('Notas de la contestación');
    await ctx.queue.idle();

    const detail = await request(ctx.app).get(`/api/documents/${res.body.results[0].document.id}`);
    expect(detail.body.document).toMatchObject({ status: 'READY', pageCount: null });
  });

  it('marks a PDF without text (scanned) as failed with an explanation', async () => {
    const res = await uploadPdf('escaneado.pdf', ['', '']);
    await ctx.queue.idle();
    const detail = await request(ctx.app).get(`/api/documents/${res.body.results[0].document.id}`);
    expect(detail.body.document.status).toBe('FAILED');
    expect(detail.body.document.errorMessage).toMatch(/escaneado/);
  });

  it('serves the original file inline', async () => {
    const res = await uploadPdf();
    const file = await request(ctx.app).get(`/api/documents/${res.body.results[0].document.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('inline');
    // Viewable in the browser's PDF viewer, but never sniffed into something executable.
    expect(file.headers['content-security-policy']).toBeUndefined();
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('updates title and category', async () => {
    const res = await uploadPdf();
    const id = res.body.results[0].document.id;
    const updated = await request(ctx.app).patch(`/api/documents/${id}`).send({ title: 'LCT', category: 'DOCTRINA' });
    expect(updated.body.document).toMatchObject({ title: 'LCT', category: 'DOCTRINA' });

    const invalid = await request(ctx.app).patch(`/api/documents/${id}`).send({ category: 'NOVELA' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('BAD_REQUEST');
  });

  it('deletes the document, its fragments and the stored file', async () => {
    const res = await uploadPdf();
    const id = res.body.results[0].document.id;
    await ctx.queue.idle();
    const stored = await ctx.db.document.findUniqueOrThrow({ where: { id } });

    expect((await request(ctx.app).delete(`/api/documents/${id}`)).status).toBe(204);
    expect(await ctx.db.documentChunk.count({ where: { documentId: id } })).toBe(0);
    expect(existsSync(ctx.storage.absolutePath(stored.storagePath))).toBe(false);
    expect((await request(ctx.app).get(`/api/documents/${id}`)).status).toBe(404);
  });

  it('reprocesses a document on demand', async () => {
    const res = await uploadPdf();
    const id = res.body.results[0].document.id;
    await ctx.queue.idle();

    const again = await request(ctx.app).post(`/api/documents/${id}/reprocess`);
    expect(again.status).toBe(202);
    await ctx.queue.idle();
    const detail = await request(ctx.app).get(`/api/documents/${id}`);
    expect(detail.body.document.status).toBe('READY');
  });

  it('validates ids and unknown routes', async () => {
    expect((await request(ctx.app).get('/api/documents/no-es-un-uuid')).status).toBe(400);
    expect((await request(ctx.app).get('/api/nada')).status).toBe(404);
  });
});
