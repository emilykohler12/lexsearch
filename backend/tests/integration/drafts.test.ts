import mammoth from 'mammoth';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp, makePdf } from '../helpers/test-app.js';

const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
const noLlm = await createTestApp({ llm: null });
afterAll(async () => {
  await ctx.close();
  await noLlm.close();
});
beforeEach(async () => {
  llm.agentCalls = [];
  await ctx.reset();
});

/** A procedural code (to search) and a base model of a carta documento (to read). */
async function seedLibrary() {
  await request(ctx.app)
    .post('/api/documents')
    .field('category', 'LEGISLACION')
    .attach(
      'files',
      await makePdf([
        'CÓDIGO PROCESAL. ARTÍCULO 338.- Traslado de la demanda. Presentada la demanda, el juez dará traslado de ella al demandado para que comparezca y la conteste dentro de quince días.',
      ]),
      'Codigo_Procesal.pdf',
    );
  const model = await request(ctx.app)
    .post('/api/documents')
    .field('category', 'MODELO')
    .attach(
      'files',
      Buffer.from('MODELO DE CARTA DOCUMENTO\n\nIntimo a usted para que en el plazo de 48 horas regularice la situación.'),
      'Modelo_CD.txt',
    );
  await ctx.queue.idle();
  return { templateId: model.body.results[0].document.id as string };
}

const request_ = {
  documentType: 'CARTA_DOCUMENTO',
  instructions: 'Intimar al empleador a registrar correctamente la relación laboral.',
  caseDetails: 'Trabajador: Juan Ejemplo. Empleador: Distribuidora Ejemplo S.A.',
};

describe('POST /api/drafts', () => {
  it('drafts with the agent and records what it consulted', async () => {
    await seedLibrary();
    const res = await request(ctx.app).post('/api/drafts').send(request_);

    expect(res.status).toBe(201);
    const { draft } = res.body;
    expect(draft.title).toBe('CD a Distribuidora Ejemplo'); // the agent's "Título:" line
    expect(draft.content.startsWith('# CARTA DOCUMENTO')).toBe(true); // title line and markdown fence removed
    expect(draft.content).toContain('Fundamento: ');
    expect(draft.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'fragment', documentTitle: 'Codigo Procesal' })]),
    );

    // The agent got the request and both library tools.
    const [call] = llm.agentCalls;
    expect(call!.userMessage).toContain('Tipo de documento: Carta documento');
    expect(call!.userMessage).toContain('Trabajador: Juan Ejemplo');
    expect(call!.tools.map((t) => t.name)).toEqual(['buscar_en_biblioteca', 'leer_documento']);
    expect(call!.systemPrompt).toContain('[COMPLETAR');

    // The run is logged with the original draft, to debug the prompt later.
    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'draft-generator' } });
    expect(interaction).toMatchObject({ status: 'SUCCESS', promptVersion: 'draft-generator.v1', model: 'fake-model' });
    expect((interaction.output as { content: string }).content).toBe(draft.content);
  });

  it('reads the base model chosen by the lawyer', async () => {
    const { templateId } = await seedLibrary();
    const res = await request(ctx.app).post('/api/drafts').send({ ...request_, templateDocumentId: templateId });

    expect(res.status).toBe(201);
    expect(res.body.draft.templateDocumentId).toBe(templateId);
    expect(res.body.draft.content).toContain('Según el modelo: MODELO DE CARTA DOCUMENTO');
    expect(res.body.draft.sources).toEqual(
      expect.arrayContaining([{ kind: 'document', documentId: templateId, documentTitle: 'Modelo CD' }]),
    );
  });

  it('rejects a base model that does not exist', async () => {
    await seedLibrary();
    const res = await request(ctx.app)
      .post('/api/drafts')
      .send({ ...request_, templateDocumentId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('validates the request', async () => {
    const res = await request(ctx.app).post('/api/drafts').send({ documentType: 'NOVELA', instructions: '' });
    expect(res.status).toBe(400);
  });

  it('needs the AI to be configured', async () => {
    const res = await request(noLlm.app).post('/api/drafts').send(request_);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_NOT_CONFIGURED');
  });
});

describe('drafts after generation', () => {
  it('can be listed, edited, exported to Word and deleted', async () => {
    const { templateId } = await seedLibrary();
    const created = await request(ctx.app).post('/api/drafts').send({ ...request_, templateDocumentId: templateId });
    const id = created.body.draft.id as string;

    const list = await request(ctx.app).get('/api/drafts');
    expect(list.body.drafts).toEqual([expect.objectContaining({ id, title: 'CD a Distribuidora Ejemplo' })]);
    expect(list.body.drafts[0]).not.toHaveProperty('content');

    const edited = await request(ctx.app)
      .patch(`/api/drafts/${id}`)
      .send({ title: 'CD Juan Ejemplo', content: '# CARTA DOCUMENTO\n\nIntimo a usted en **48 horas**.' });
    expect(edited.body.draft).toMatchObject({ title: 'CD Juan Ejemplo' });

    const docx = await request(ctx.app).get(`/api/drafts/${id}/docx`).buffer(true).parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
    expect(docx.status).toBe(200);
    expect(docx.headers['content-disposition']).toContain('CD Juan Ejemplo.docx');
    const { value: text } = await mammoth.extractRawText({ buffer: docx.body as Buffer });
    expect(text).toContain('CARTA DOCUMENTO');
    expect(text).toContain('Intimo a usted en 48 horas.');

    // Deleting the base model keeps the draft (the link is cleared).
    await request(ctx.app).delete(`/api/documents/${templateId}`);
    const afterModelDeleted = await request(ctx.app).get(`/api/drafts/${id}`);
    expect(afterModelDeleted.body.draft.templateDocumentId).toBeNull();

    expect((await request(ctx.app).delete(`/api/drafts/${id}`)).status).toBe(204);
    expect((await request(ctx.app).get(`/api/drafts/${id}`)).status).toBe(404);
  });
});
