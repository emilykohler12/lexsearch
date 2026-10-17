import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CONTRATO, modelAnswer, RECIBO, TESTIGO } from '../helpers/contradiction-fixtures.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp } from '../helpers/test-app.js';

// The errors are in contradiction-analysis-errors.test.ts: this endpoint allows 10 comparisons a
// minute per app and each test file builds its own.
const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
afterAll(() => ctx.close());
beforeEach(async () => {
  llm.structuredCalls = [];
  llm.structuredData = { findings: [] };
  llm.structuredError = null;
  await ctx.reset();
});

interface Doc {
  id: string;
  title: string;
}

async function uploadDocument(caseId: string, name: string, text: string): Promise<Doc> {
  const res = await request(ctx.app)
    .post('/api/documents')
    .field('category', 'PRUEBA')
    .field('caseId', caseId)
    .attach('files', Buffer.from(text), name);
  await ctx.queue.idle();
  return res.body.results[0].document;
}

async function setup() {
  const { id } = (await request(ctx.app).post('/api/cases').send({ title: 'Ramírez c/ Transportes' })).body.case as { id: string };
  const contrato = await uploadDocument(id, 'Contrato de locación.txt', CONTRATO);
  const testigo = await uploadDocument(id, 'Declaración de Laura.txt', TESTIGO);
  const recibo = await uploadDocument(id, 'Recibo de abril.txt', RECIBO);
  return { caseId: id, contrato, testigo, recibo };
}

const analyze = (caseId: string, body: object) => request(ctx.app).post(`/api/cases/${caseId}/contradictions/analyze`).send(body);

describe('POST /api/cases/:id/contradictions/analyze', () => {
  it('compares the documents and proposes the findings with their quotes checked, clear ones first', async () => {
    const { caseId, contrato, testigo, recibo } = await setup();
    llm.structuredData = modelAnswer;

    const res = await analyze(caseId, { documentIds: [contrato.id, testigo.id, recibo.id] });

    expect(res.status).toBe(200);
    const { proposal } = res.body;
    // The model put the date first; the clear one (the amount) comes first for the lawyer.
    expect(proposal.findings.map((f: { title: string; confidence: string }) => `${f.confidence}: ${f.title}`)).toEqual([
      'DIRECTA: Monto del alquiler mensual',
      'POSIBLE: Fecha en que el locatario empezó a usar la vivienda',
    ]);
    expect(proposal.findings[0]).toMatchObject({ kind: 'MONTO', verified: true, duplicate: false });
    expect(proposal.findings[0].statements).toEqual([
      {
        documentId: contrato.id,
        documentTitle: 'Contrato de locación',
        quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes',
        quoteVerified: true,
      },
      {
        documentId: recibo.id,
        documentTitle: 'Recibo de abril',
        quote: 'la suma de $180.000 en concepto de alquiler del mes de abril de 2023',
        quoteVerified: true,
      },
      {
        documentId: testigo.id,
        documentTitle: 'Declaración de Laura',
        quote: 'el alquiler era de ciento cincuenta mil pesos por mes',
        quoteVerified: true,
      },
    ]);
    // (The characters are those of the text read from the file, which is tidied up: paragraphs are separated by a blank line.)
    expect(proposal.documents).toEqual([
      { id: contrato.id, title: 'Contrato de locación', chars: expect.any(Number), truncated: false },
      { id: testigo.id, title: 'Declaración de Laura', chars: expect.any(Number), truncated: false },
      { id: recibo.id, title: 'Recibo de abril', chars: expect.any(Number), truncated: false },
    ]);
    expect(proposal.documents[0].chars).toBeGreaterThanOrEqual(CONTRATO.length);

    // The model got the three texts as data, numbered in the order the lawyer chose, with more time and reasoning than usual.
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain('id="D1" titulo="Contrato de locación"');
    expect(call!.userMessage).toContain('id="D3" titulo="Recibo de abril"');
    expect(call!.userMessage).toContain('el alquiler mensual es de $180.000');
    expect(call!.userMessage).toContain('no instrucciones');
    expect(call!.systemPrompt).toContain('contradicciones');
    expect(call).toMatchObject({ timeoutMs: 90_000, minReasoning: 'medium' });

    // Reading saves nothing.
    expect(await ctx.db.contradiction.count()).toBe(0);
  });

  it('records the comparison without the text of the documents', async () => {
    const { caseId, contrato, testigo } = await setup();
    llm.structuredData = modelAnswer;

    await analyze(caseId, { documentIds: [contrato.id, testigo.id], focus: 'el monto del alquiler' });

    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'contradiction-detection' } });
    expect(interaction).toMatchObject({ status: 'SUCCESS', promptVersion: 'contradiction-detection.v1', model: 'fake-model' });
    expect(interaction.input).toMatchObject({
      caseId,
      focus: 'el monto del alquiler',
      documents: [
        { id: contrato.id, title: 'Contrato de locación', chars: expect.any(Number), sentChars: expect.any(Number), truncated: false },
        { id: testigo.id, title: 'Declaración de Laura', chars: expect.any(Number), sentChars: expect.any(Number), truncated: false },
      ],
    });
    expect(JSON.stringify(interaction.input)).not.toContain('Marta Ejemplo');
  });

  it('numbers the documents in the order the lawyer chose and passes on what she wants to look at', async () => {
    const { caseId, contrato, recibo } = await setup();

    const res = await analyze(caseId, { documentIds: [recibo.id, contrato.id], focus: '  la fecha de entrega  ' });

    expect(res.status).toBe(200);
    expect(res.body.proposal).toMatchObject({ findings: [] });
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain('id="D1" titulo="Recibo de abril"');
    expect(call!.userMessage).toContain('id="D2" titulo="Contrato de locación"');
    expect(call!.userMessage).toContain('Lo que el abogado quiere revisar primero: la fecha de entrega');
  });

  it('flags a quote the model made up and drops what points at a document it was not given', async () => {
    const { caseId, contrato, testigo } = await setup();
    llm.structuredData = {
      findings: [
        {
          ...modelAnswer.findings[1]!,
          statements: [
            { document: 'D1', quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes' },
            { document: 'D2', quote: 'dijo que el alquiler era de cien mil pesos' },
            { document: 'D7', quote: 'otro documento que no se dio' },
          ],
        },
      ],
    };

    const { proposal } = (await analyze(caseId, { documentIds: [contrato.id, testigo.id] })).body;

    expect(proposal.findings).toHaveLength(1);
    expect(proposal.findings[0].verified).toBe(false);
    expect(proposal.findings[0].statements).toHaveLength(2);
    expect(proposal.findings[0].statements[1]).toMatchObject({ documentId: testigo.id, quote: '', quoteVerified: false });
  });

  it('marks the findings the expediente already has confirmed', async () => {
    const { caseId, contrato, testigo, recibo } = await setup();
    llm.structuredData = modelAnswer;
    const first = (await analyze(caseId, { documentIds: [contrato.id, testigo.id, recibo.id] })).body.proposal;
    await request(ctx.app)
      .post(`/api/cases/${caseId}/contradictions`)
      .send({ items: [first.findings[0]].map(({ verified: _verified, duplicate: _duplicate, ...item }) => item) });

    const again = (await analyze(caseId, { documentIds: [contrato.id, testigo.id, recibo.id] })).body.proposal;

    expect(again.findings.map((f: { title: string; duplicate: boolean }) => `${f.title}: ${f.duplicate}`)).toEqual([
      'Monto del alquiler mensual: true',
      'Fecha en que el locatario empezó a usar la vivienda: false',
    ]);
  });

  it('says which documents were read only in part when they are too long', async () => {
    const { caseId, contrato } = await setup();
    const long = await uploadDocument(caseId, 'Expediente completo.txt', `${TESTIGO}\n${'Texto de relleno del expediente. '.repeat(3_000)}\nFIN`);

    const { proposal } = (await analyze(caseId, { documentIds: [contrato.id, long.id] })).body;

    expect(proposal.documents.map((d: { truncated: boolean }) => d.truncated)).toEqual([false, true]);
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain('se omite una parte del documento');
    // Short ones are sent whole.
    expect(call!.userMessage).toContain('CLÁUSULA TERCERA: el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes.');
  });
});
