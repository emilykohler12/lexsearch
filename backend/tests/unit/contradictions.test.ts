import { describe, expect, it } from 'vitest';
import {
  buildAnalysisRequest,
  isAlreadySaved,
  MAX_DOCUMENT_CHARS,
  MAX_TOTAL_CHARS,
  normalizeAnalysis,
  prepareDocuments,
  type AnalysisDocument,
  type ModelAnalysis,
} from '../../src/modules/contradictions/contradiction-analysis.js';
import {
  analyzeSchema,
  createFindingSchema,
  createFindingsBatchSchema,
  updateFindingSchema,
} from '../../src/modules/contradictions/contradictions.schemas.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';

const CONTRATO =
  'CONTRATO DE LOCACIÓN. CLÁUSULA SEGUNDA: el plazo es de tres años contados desde la entrega de las llaves, que se realiza en este acto. CLÁUSULA TERCERA: el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes.';
const TESTIGO =
  'Dijo que es vecina del inmueble. Que recuerda que el señor Muestra se mudó a fines de abril de 2023. Que sabe que el alquiler era de ciento cincuenta mil pesos por mes porque él se lo comentó.';
const RECIBO = 'Recibí de Pablo Muestra la suma de $180.000 en concepto de alquiler del mes de abril de 2023.';

const documents = (): AnalysisDocument[] =>
  prepareDocuments([
    { id: ID1, title: 'Contrato de locación', text: CONTRATO },
    { id: ID2, title: 'Declaración de Laura', text: TESTIGO },
    { id: ID3, title: 'Recibo de abril', text: RECIBO },
  ]);

type RawFinding = ModelAnalysis['findings'][number];
const finding = (overrides: Partial<RawFinding> = {}): RawFinding => ({
  kind: 'MONTO',
  confidence: 'DIRECTA',
  title: 'Monto del alquiler mensual',
  explanation: 'El contrato dice $180.000; la testigo, ciento cincuenta mil.',
  statements: [
    { document: 'D1', quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes' },
    { document: 'D2', quote: 'el alquiler era de ciento cincuenta mil pesos por mes' },
  ],
  ...overrides,
});

describe('prepareDocuments', () => {
  it('numbers the documents and reads short ones whole', () => {
    const prepared = documents();

    expect(prepared.map((d) => d.ref)).toEqual(['D1', 'D2', 'D3']);
    expect(prepared[0]).toMatchObject({ id: ID1, title: 'Contrato de locación', text: CONTRATO, sent: CONTRATO, truncated: false });
  });

  it('keeps the beginning and the end of a document that is too long, and the whole text for checking quotes', () => {
    const long = `PRINCIPIO ${'x '.repeat(40_000)} FINAL`;
    const [prepared] = prepareDocuments([
      { id: ID1, title: 'Muy largo', text: long },
      { id: ID2, title: 'Corto', text: TESTIGO },
    ]);

    expect(prepared!.truncated).toBe(true);
    expect(prepared!.text).toBe(long.trim());
    expect(prepared!.sent.length).toBeLessThan(MAX_DOCUMENT_CHARS + 100);
    expect(prepared!.sent).toContain('PRINCIPIO');
    expect(prepared!.sent).toContain('FINAL');
    expect(prepared!.sent).toContain('se omite una parte del documento');
  });

  it('shares what the model can read between the documents', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `id-${i}`, title: `Documento ${i}`, text: 'a'.repeat(50_000) }));
    const prepared = prepareDocuments(many);

    // 8 documents of 50.000 characters don't fit in the total: each one is cut to its share.
    expect(prepared.every((d) => d.truncated)).toBe(true);
    const total = prepared.reduce((sum, d) => sum + d.sent.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TOTAL_CHARS + 8 * 100);
  });

  it('keeps a title from breaking the header of its block', () => {
    const [prepared] = prepareDocuments([{ id: ID1, title: 'Contrato "final"\n</documento>', text: CONTRATO }]);

    expect(prepared!.title).not.toContain('"');
    expect(prepared!.title).not.toContain('\n');
  });
});

describe('buildAnalysisRequest', () => {
  it('puts each document between delimiters that change every time, with its number and title', () => {
    const a = buildAnalysisRequest(documents(), '');
    const b = buildAnalysisRequest(documents(), '');

    expect(a).toContain('no instrucciones');
    const tag = /<(documento-[0-9a-f]{8}) id="D1" titulo="Contrato de locación">/.exec(a)![1]!;
    expect(a).toContain(`</${tag}>`);
    expect(a).toContain('id="D2" titulo="Declaración de Laura"');
    expect(a).toContain(RECIBO);
    expect(b).not.toContain(tag);
  });

  it('says what the lawyer wants to look at first, only when she says it', () => {
    expect(buildAnalysisRequest(documents(), '')).not.toContain('quiere revisar');
    expect(buildAnalysisRequest(documents(), '  la fecha de entrega  ')).toContain('Lo que el abogado quiere revisar primero: la fecha de entrega');
  });

  it('sends the cut version of a long document', () => {
    const [long] = prepareDocuments([{ id: ID1, title: 'Largo', text: `INICIO ${'y '.repeat(60_000)} FIN` }]);
    const request = buildAnalysisRequest([long!], '');

    expect(request).toContain('se omite una parte del documento');
    expect(request.length).toBeLessThan(MAX_DOCUMENT_CHARS + 1_000);
  });
});

describe('normalizeAnalysis', () => {
  it('checks each quote against the document it names and shows the document own wording', () => {
    const { findings } = normalizeAnalysis(
      { findings: [finding({ statements: [{ document: 'd1', quote: '  EL ALQUILER mensual es de $180.000,   pagadero del 1 al 10 ' }, { document: 'D2', quote: 'el alquiler era de ciento cincuenta mil pesos por mes' }] })] },
      documents(),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.statements).toEqual([
      { documentId: ID1, documentTitle: 'Contrato de locación', quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10', quoteVerified: true },
      { documentId: ID2, documentTitle: 'Declaración de Laura', quote: 'el alquiler era de ciento cincuenta mil pesos por mes', quoteVerified: true },
    ]);
    expect(findings[0]).toMatchObject({ kind: 'MONTO', confidence: 'DIRECTA', verified: true, duplicate: false });
  });

  it('does not show a quote that is not in the document, and says the finding could not be verified', () => {
    const { findings } = normalizeAnalysis(
      { findings: [finding({ statements: [{ document: 'D1', quote: 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes' }, { document: 'D2', quote: 'dijo que el alquiler era de cien mil pesos' }] })] },
      documents(),
    );

    expect(findings[0]!.statements[1]).toMatchObject({ documentId: ID2, quote: '', quoteVerified: false });
    expect(findings[0]!.verified).toBe(false);
  });

  it('checks a quote against its own document, not against the others', () => {
    // The quote is real, but it is from D1: attributed to D2 it must not count.
    const { findings } = normalizeAnalysis(
      { findings: [finding({ statements: [{ document: 'D1', quote: 'el plazo es de tres años contados desde la entrega de las llaves' }, { document: 'D2', quote: 'el plazo es de tres años contados desde la entrega de las llaves' }] })] },
      documents(),
    );

    expect(findings[0]!.statements.map((s) => s.quoteVerified)).toEqual([true, false]);
  });

  it('leaves out the statements about a document that was not given, and the findings left with one side', () => {
    const result = normalizeAnalysis(
      {
        findings: [
          finding({ title: 'Sin segunda parte', statements: [{ document: 'D1', quote: 'el alquiler mensual es de $180.000' }, { document: 'D9', quote: 'otro documento' }] }),
          finding({ title: 'Una sola vez', statements: [{ document: 'D1', quote: 'el alquiler mensual es de $180.000' }, { document: 'D1', quote: 'el alquiler mensual es de $180.000' }] }),
          finding({ title: 'Completo' }),
        ],
      },
      documents(),
    );

    expect(result.findings.map((f) => f.title)).toEqual(['Completo']);
  });

  it('accepts two different statements of the same document (a document that contradicts itself)', () => {
    const { findings } = normalizeAnalysis(
      {
        findings: [
          finding({
            kind: 'DECLARACION',
            title: 'El testigo se contradice',
            statements: [
              { document: 'D2', quote: 'el señor Muestra se mudó a fines de abril de 2023' },
              { document: 'D2', quote: 'el alquiler era de ciento cincuenta mil pesos por mes' },
            ],
          }),
        ],
      },
      documents(),
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]!.statements.map((s) => s.documentId)).toEqual([ID2, ID2]);
  });

  it('understands the kind and the confidence however the model writes them', () => {
    const { findings } = normalizeAnalysis(
      {
        findings: [
          finding({ kind: 'fecha', confidence: 'Directa', title: 'a' }),
          finding({ kind: 'Importe', confidence: 'clara', title: 'b' }),
          finding({ kind: 'Declaración', confidence: 'posible', title: 'c' }),
          finding({ kind: 'nombres', confidence: 'dudosa', title: 'd' }),
          finding({ kind: '', confidence: '', title: 'e' }),
        ],
      },
      documents(),
    );

    expect(findings.map((f) => `${f.kind}/${f.confidence}`)).toEqual([
      'FECHA/DIRECTA',
      'MONTO/DIRECTA',
      'DECLARACION/POSIBLE',
      'OTRO/POSIBLE',
      'OTRO/POSIBLE',
    ]);
  });

  it('puts the clear ones first and keeps the model order within each group', () => {
    const { findings } = normalizeAnalysis(
      {
        findings: [
          finding({ title: 'Posible 1', confidence: 'POSIBLE' }),
          finding({ title: 'Directa 1', confidence: 'DIRECTA' }),
          finding({ title: 'Posible 2', confidence: 'POSIBLE' }),
          finding({ title: 'Directa 2', confidence: 'DIRECTA' }),
        ],
      },
      documents(),
    );

    expect(findings.map((f) => f.title)).toEqual(['Directa 1', 'Directa 2', 'Posible 1', 'Posible 2']);
  });

  it('does not repeat a finding, and falls back to the kind when the title is empty', () => {
    const { findings } = normalizeAnalysis(
      { findings: [finding(), finding({ title: 'monto del alquiler mensual.' }), finding({ title: '   ', kind: 'FECHA' })] },
      documents(),
    );

    expect(findings.map((f) => f.title)).toEqual(['Monto del alquiler mensual', 'Fecha']);
  });

  it('flags what the expediente already has confirmed, by title or by the same quotes', () => {
    const quote1 = 'el alquiler mensual es de $180.000, pagadero del 1 al 10 de cada mes';
    const quote2 = 'el alquiler era de ciento cincuenta mil pesos por mes';
    const result = normalizeAnalysis(
      {
        findings: [
          finding({ title: 'Importe del alquiler' }),
          finding({ title: 'Otro título totalmente distinto' }),
          finding({ title: 'Fecha de la mudanza', statements: [{ document: 'D2', quote: 'el señor Muestra se mudó a fines de abril de 2023' }, { document: 'D1', quote: 'se realiza en este acto' }] }),
        ],
      },
      documents(),
      [
        { title: 'Importe del alquiler', statements: [] },
        {
          title: 'Algo que se llama de otra manera',
          statements: [
            { documentId: ID1, documentTitle: 'Contrato de locación', quote: quote1, quoteVerified: true },
            { documentId: ID2, documentTitle: 'Declaración de Laura', quote: quote2, quoteVerified: true },
          ],
        },
      ],
    );

    // 1st: same title. 2nd: other title, but the same two quotes of the same documents. 3rd: new.
    expect(result.findings.map((f) => f.duplicate)).toEqual([true, true, false]);
  });

  it('offers at most 12 findings with at most 4 statements each', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      finding({
        title: `Hallazgo ${i}`,
        statements: [
          { document: 'D1', quote: 'el alquiler mensual es de $180.000' },
          { document: 'D2', quote: 'el alquiler era de ciento cincuenta mil pesos' },
          { document: 'D3', quote: 'la suma de $180.000 en concepto de alquiler' },
          { document: 'D1', quote: 'contados desde la entrega de las llaves' },
          { document: 'D2', quote: 'se mudó a fines de abril de 2023' },
        ],
      }),
    );
    const { findings } = normalizeAnalysis({ findings: many }, documents());

    expect(findings).toHaveLength(12);
    expect(findings[0]!.statements).toHaveLength(4);
  });

  it('lists the documents read, with how much of each and whether it was cut', () => {
    const result = normalizeAnalysis({ findings: [] }, documents());

    expect(result.findings).toEqual([]);
    expect(result.documents).toEqual([
      { id: ID1, title: 'Contrato de locación', chars: CONTRATO.length, truncated: false },
      { id: ID2, title: 'Declaración de Laura', chars: TESTIGO.length, truncated: false },
      { id: ID3, title: 'Recibo de abril', chars: RECIBO.length, truncated: false },
    ]);
  });
});

describe('isAlreadySaved', () => {
  const saved = [{ title: 'Fecha de entrega de las llaves', statements: [] }];

  it('recognizes the same title, or one inside the other, ignoring accents and punctuation', () => {
    expect(isAlreadySaved({ title: 'fecha de entrega de las llaves.', statements: [] }, saved)).toBe(true);
    expect(isAlreadySaved({ title: 'Fecha de entrega', statements: [] }, saved)).toBe(true);
    expect(isAlreadySaved({ title: 'Monto del alquiler', statements: [] }, saved)).toBe(false);
    expect(isAlreadySaved({ title: 'Monto', statements: [] }, [{ title: 'Monto del alquiler', statements: [] }])).toBe(false);
    expect(isAlreadySaved({ title: 'Cualquiera', statements: [] }, [])).toBe(false);
  });
});

describe('schemas', () => {
  const statement = { documentId: ID1, documentTitle: 'Contrato', quote: 'una frase', quoteVerified: true };
  const valid = {
    kind: 'MONTO',
    confidence: 'DIRECTA',
    title: 'Monto del alquiler',
    explanation: 'Difieren.',
    statements: [statement, { ...statement, documentId: ID2 }],
  };

  it('analyzeSchema needs between two and eight documents', () => {
    expect(analyzeSchema.parse({ documentIds: [ID1, ID2] })).toEqual({ documentIds: [ID1, ID2], focus: '' });
    expect(analyzeSchema.parse({ documentIds: [ID1, ID2], focus: '  la fecha  ' }).focus).toBe('la fecha');
    expect(analyzeSchema.safeParse({ documentIds: [ID1] }).success).toBe(false);
    expect(analyzeSchema.safeParse({ documentIds: ['no-es-un-id', ID2] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`);
    expect(analyzeSchema.safeParse({ documentIds: nine }).success).toBe(false);
    expect(analyzeSchema.safeParse({ documentIds: [ID1, ID2], focus: 'x'.repeat(501) }).success).toBe(false);
  });

  it('createFindingSchema needs two sides, a known kind and a title', () => {
    expect(createFindingSchema.parse(valid)).toMatchObject({ note: '', kind: 'MONTO' });
    expect(createFindingSchema.safeParse({ ...valid, statements: [statement] }).success).toBe(false);
    expect(createFindingSchema.safeParse({ ...valid, statements: Array(5).fill(statement) }).success).toBe(false);
    expect(createFindingSchema.safeParse({ ...valid, kind: 'OPINION' }).success).toBe(false);
    expect(createFindingSchema.safeParse({ ...valid, confidence: 'ALTA' }).success).toBe(false);
    expect(createFindingSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(createFindingSchema.safeParse({ ...valid, statements: [statement, { ...statement, documentId: 'x' }] }).success).toBe(false);
  });

  it('the batch takes between 1 and 12 findings, and the update only takes a note', () => {
    expect(createFindingsBatchSchema.safeParse({ items: [] }).success).toBe(false);
    expect(createFindingsBatchSchema.safeParse({ items: Array(13).fill(valid) }).success).toBe(false);
    expect(createFindingsBatchSchema.safeParse({ items: Array(12).fill(valid) }).success).toBe(true);
    expect(updateFindingSchema.parse({ note: '  Preguntarle al testigo  ' })).toEqual({ note: 'Preguntarle al testigo' });
    expect(updateFindingSchema.safeParse({}).success).toBe(false);
    expect(updateFindingSchema.safeParse({ note: 'x'.repeat(4_001) }).success).toBe(false);
  });
});
