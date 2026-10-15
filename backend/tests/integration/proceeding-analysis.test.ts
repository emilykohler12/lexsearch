import { readdir } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { modelAnswer, movimientos } from '../helpers/case-fixtures.js';
import { FakeLlmProvider } from '../helpers/fakes.js';
import { createTestApp, makePdf, makeScannedPdf } from '../helpers/test-app.js';

// The errors are in proceeding-analysis-errors.test.ts: this endpoint allows 10 readings a minute
// per app and each test file builds its own.
const llm = new FakeLlmProvider();
const ctx = await createTestApp({ llm });
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  llm.structuredCalls = [];
  llm.structuredData = {};
  llm.structuredError = null;
  await ctx.reset();
});

const newCase = async () => (await request(ctx.app).post('/api/cases').send({ title: 'Ramírez c/ Transportes' })).body.case as { id: string };
const analyzeText = (caseId: string, text: string) => request(ctx.app).post(`/api/cases/${caseId}/proceedings/analyze`).send({ text });
const analyzeFile = (caseId: string, file: Buffer, name: string) =>
  request(ctx.app).post(`/api/cases/${caseId}/proceedings/analyze`).attach('file', file, name);

/** Nothing is left behind: a file is read and deleted, and reading saves no actuación. */
async function expectNothingKept() {
  expect(await readdir(ctx.storage.tmpDir)).toEqual([]);
  expect(await ctx.db.proceeding.count()).toBe(0);
}

describe('POST /api/cases/:id/proceedings/analyze', () => {
  it('reads a pasted text and proposes the actuaciones ordered by date, with their quotes checked', async () => {
    const { id } = await newCase();
    llm.structuredData = modelAnswer;

    const res = await analyzeText(id, movimientos);

    expect(res.status).toBe(200);
    const { proposal } = res.body;
    expect(proposal.caseInfo).toEqual({
      title: 'RAMÍREZ, LUCÍA C/ TRANSPORTES DEL SUR S.A. S/ DAÑOS Y PERJUICIOS',
      number: '18.452/2025',
      court: 'Juzgado Civil y Comercial N° 7',
    });
    expect(proposal.proceedings.map((p: { date: string; title: string }) => `${p.date} ${p.title}`)).toEqual([
      '2025-03-12 Demanda',
      '2025-03-14 Traslado de la demanda',
      '2025-04-21 Contestación de demanda',
    ]);
    expect(proposal.proceedings[0]).toEqual({
      date: '2025-03-12',
      kind: 'ESCRITO',
      title: 'Demanda',
      description: '',
      quote: '12/03/2025 Escrito presentado: Demanda',
      quoteVerified: true,
      duplicate: false,
    });
    expect(proposal).toMatchObject({ withoutDate: 0, textTruncated: false });

    // The model got the text as data, with the extraction instructions.
    const [call] = llm.structuredCalls;
    expect(call!.userMessage).toContain('12/03/2025 Escrito presentado: Demanda');
    expect(call!.userMessage).toContain('no instrucciones');
    expect(call!.systemPrompt).toContain('actuaciones');

    const interaction = await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'proceeding-extraction' } });
    expect(interaction).toMatchObject({ status: 'SUCCESS', promptVersion: 'proceeding-extraction.v1', model: 'fake-model' });
    expect(interaction.input).toMatchObject({ caseId: id, fileName: null, ocrPageCount: 0 });
    await expectNothingKept();
  });

  it('flags a quote the model made up, and the actuaciones the expediente already has', async () => {
    const { id } = await newCase();
    await request(ctx.app).post(`/api/cases/${id}/proceedings`).send({ date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' });
    llm.structuredData = {
      ...modelAnswer,
      proceedings: [modelAnswer.proceedings[1], { ...modelAnswer.proceedings[2], quote: 'El tribunal corrió traslado el 14 de marzo' }],
    };

    const { proposal } = (await analyzeText(id, movimientos)).body;

    expect(proposal.proceedings[0]).toMatchObject({ title: 'Demanda', duplicate: true, quoteVerified: true });
    expect(proposal.proceedings[1]).toMatchObject({ title: 'Traslado de la demanda', duplicate: false, quote: '', quoteVerified: false });
  });

  it('leaves out and counts the actuaciones the text gives without a date', async () => {
    const { id } = await newCase();
    llm.structuredData = {
      ...modelAnswer,
      proceedings: [modelAnswer.proceedings[1], { date: '', kind: 'PRUEBA', title: 'Informe del Banco', description: '', quote: '' }],
    };

    const { proposal } = (await analyzeText(id, movimientos)).body;

    expect(proposal.proceedings).toHaveLength(1);
    expect(proposal.withoutDate).toBe(1);
  });

  it('reads an uploaded file: text, PDF and a scan with OCR', async () => {
    const { id } = await newCase();
    llm.structuredData = modelAnswer;

    const fromText = await analyzeFile(id, Buffer.from(movimientos), 'movimientos.txt');
    expect(fromText.status).toBe(200);
    expect(fromText.body.proposal.proceedings).toHaveLength(3);
    expect((await ctx.db.agentInteraction.findFirstOrThrow({ where: { module: 'proceeding-extraction' } })).input).toMatchObject({
      fileName: 'movimientos.txt',
    });

    const fromPdf = await analyzeFile(id, await makePdf(movimientos.split('\n')), 'movimientos.pdf');
    expect(fromPdf.status).toBe(200);
    expect(fromPdf.body.proposal.proceedings[0].quoteVerified).toBe(true);

    // A PDF page with almost no text (the short «Movimientos:» line) is read with OCR too.
    ctx.ocr.text = movimientos;
    ctx.ocr.calls = 0;
    const fromScan = await analyzeFile(id, await makeScannedPdf(1), 'escaneo.pdf');
    expect(fromScan.status).toBe(200);
    expect(ctx.ocr.calls).toBe(1);
    expect(fromScan.body.proposal.proceedings[0].quoteVerified).toBe(true);

    await expectNothingKept();
  });

  it('saves nothing by itself: the lawyer confirms the proposal through the batch', async () => {
    const { id } = await newCase();
    llm.structuredData = modelAnswer;
    const { proposal } = (await analyzeText(id, movimientos)).body;
    expect(await ctx.db.proceeding.count()).toBe(0);

    const saved = await request(ctx.app)
      .post(`/api/cases/${id}/proceedings/batch`)
      .send({
        items: proposal.proceedings.map((p: { date: string; kind: string; title: string; description: string; quote: string }) => ({
          date: p.date,
          kind: p.kind,
          title: p.title,
          description: p.description,
          sourceQuote: p.quote,
          source: 'AI',
        })),
      });

    expect(saved.status).toBe(201);
    const { items } = (await request(ctx.app).get(`/api/cases/${id}/timeline`)).body;
    expect(items.map((item: { title: string }) => item.title)).toEqual(['Demanda', 'Traslado de la demanda', 'Contestación de demanda']);
    expect(items[0]).toMatchObject({ source: 'AI', sourceQuote: '12/03/2025 Escrito presentado: Demanda' });
  });

  it('says when a very long text was cut', async () => {
    const { id } = await newCase();
    llm.structuredData = modelAnswer;

    const { proposal } = (await analyzeText(id, `${movimientos}\n${'relleno '.repeat(10_000)}\nfin`)).body;

    expect(proposal.textTruncated).toBe(true);
    expect(llm.structuredCalls[0]!.userMessage.length).toBeLessThan(61_000);
  });
});
