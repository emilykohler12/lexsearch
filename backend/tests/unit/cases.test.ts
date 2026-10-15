import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../../src/modules/cases/case-timeline.js';
import {
  createCaseSchema,
  createProceedingSchema,
  createProceedingsBatchSchema,
  updateCaseSchema,
  updateProceedingSchema,
  type ProceedingDto,
} from '../../src/modules/cases/cases.schemas.js';
import {
  buildAnalysisRequest,
  comparableTitle,
  isRepeated,
  normalizeAnalysis,
  normalizeKind,
  type ModelAnalysis,
} from '../../src/modules/cases/proceeding-analysis.js';
import type { toDeadlineDto } from '../../src/modules/deadlines/deadlines.schemas.js';

const text = [
  'JUZGADO CIVIL Y COMERCIAL N° 7 — Expte. 18.452/2025 «RAMÍREZ, LUCÍA C/ TRANSPORTES DEL SUR S.A.»',
  '12/03/2025 Escrito presentado: Demanda',
  '14/03/2025 Providencia: Por presentada, parte y domicilio constituido. Traslado por 15 días.',
  '21/04/2025 Escrito presentado: Contesta demanda',
].join('\n');

type RawItem = ModelAnalysis['proceedings'][number];
const raw = (items: Array<Partial<RawItem>>, extra: Partial<ModelAnalysis> = {}): ModelAnalysis => ({
  caseTitle: '',
  caseNumber: '',
  court: '',
  proceedings: items.map((item) => ({ date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda', description: '', quote: '', ...item })),
  ...extra,
});

describe('normalizeKind', () => {
  it('keeps the codes and understands accents, case and common synonyms', () => {
    for (const code of ['ESCRITO', 'RESOLUCION', 'NOTIFICACION', 'AUDIENCIA', 'PRUEBA', 'OTRO']) {
      expect(normalizeKind(code)).toBe(code);
    }
    expect(normalizeKind('Resolución')).toBe('RESOLUCION');
    expect(normalizeKind(' notificación ')).toBe('NOTIFICACION');
    expect(normalizeKind('Sentencia')).toBe('RESOLUCION');
    expect(normalizeKind('Providencia')).toBe('RESOLUCION');
    expect(normalizeKind('Cédula')).toBe('NOTIFICACION');
    expect(normalizeKind('Presentación')).toBe('ESCRITO');
    expect(normalizeKind('Pericia')).toBe('PRUEBA');
  });

  it('falls back to OTRO', () => {
    expect(normalizeKind('')).toBe('OTRO');
    expect(normalizeKind('desglose')).toBe('OTRO');
  });
});

describe('comparableTitle and isRepeated', () => {
  it('ignores case, accents and punctuation', () => {
    expect(comparableTitle('  Contestación de demanda. ')).toBe('contestacion de demanda');
    expect(comparableTitle('AUDIENCIA — preliminar')).toBe('audiencia preliminar');
  });

  it('flags an actuación of the same day with the same (or a contained) title', () => {
    const existing = [{ date: '2025-03-12', title: 'Demanda de daños y perjuicios' }];
    expect(isRepeated({ date: '2025-03-12', title: 'demanda de danos y perjuicios' }, existing)).toBe(true);
    expect(isRepeated({ date: '2025-03-12', title: 'Demanda' }, existing)).toBe(true);
    expect(isRepeated({ date: '2025-03-13', title: 'Demanda' }, existing)).toBe(false);
    expect(isRepeated({ date: '2025-03-12', title: 'Contestación' }, existing)).toBe(false);
    expect(isRepeated({ date: '2025-03-12', title: 'Demanda' }, [])).toBe(false);
  });
});

describe('normalizeAnalysis', () => {
  it('orders by date and keeps the order of the text within a day', () => {
    const result = normalizeAnalysis(
      raw([
        { date: '2025-04-21', title: 'Contestación de demanda' },
        { date: '2025-03-14', title: 'Traslado' },
        { date: '2025-03-12', title: 'Demanda B' },
        { date: '2025-03-12', title: 'Demanda A' },
      ]),
      text,
    );

    expect(result.proceedings.map((p) => `${p.date} ${p.title}`)).toEqual([
      '2025-03-12 Demanda B',
      '2025-03-12 Demanda A',
      '2025-03-14 Traslado',
      '2025-04-21 Contestación de demanda',
    ]);
  });

  it('checks each quote against the text and shows the text own wording', () => {
    const result = normalizeAnalysis(raw([{ quote: '12/03/2025   ESCRITO presentado: demanda' }]), text);

    expect(result.proceedings[0]).toMatchObject({ quote: '12/03/2025 Escrito presentado: Demanda', quoteVerified: true });
  });

  it('keeps an actuación whose quote is not in the text, but flags it and shows no quote', () => {
    const result = normalizeAnalysis(raw([{ quote: 'El actor presentó la demanda el 12 de marzo' }]), text);

    expect(result.proceedings).toHaveLength(1);
    expect(result.proceedings[0]).toMatchObject({ quote: '', quoteVerified: false });
  });

  it('leaves out the actuaciones without a real date and counts them', () => {
    const result = normalizeAnalysis(
      raw([
        { date: '', title: 'Sin fecha' },
        { date: '12/03/2025', title: 'Fecha mal escrita' },
        { date: '2025-02-30', title: 'Día que no existe' },
        { date: '1999-12-31', title: 'Año fuera de rango' },
        { date: '2025-03-12', title: 'Demanda' },
      ]),
      text,
    );

    expect(result.proceedings.map((p) => p.title)).toEqual(['Demanda']);
    expect(result.withoutDate).toBe(4);
  });

  it('does not offer the same actuación twice', () => {
    const result = normalizeAnalysis(
      raw([
        { date: '2025-03-12', title: 'Contestación de demanda' },
        { date: '2025-03-12', title: 'contestacion de demanda.' },
        { date: '2025-03-13', title: 'Contestación de demanda' },
      ]),
      text,
    );

    expect(result.proceedings).toHaveLength(2);
  });

  it('flags the ones the expediente already has', () => {
    const result = normalizeAnalysis(
      raw([
        { date: '2025-03-12', title: 'Demanda' },
        { date: '2025-03-14', title: 'Traslado de la demanda' },
      ]),
      text,
      [{ date: '2025-03-12', title: 'Demanda' }],
    );

    expect(result.proceedings.map((p) => p.duplicate)).toEqual([true, false]);
  });

  it('cleans the kind, the title and the data of the expediente', () => {
    const result = normalizeAnalysis(
      raw([{ kind: 'Resolución', title: '   ', description: '  Se corre\n traslado   por 15 días. ' }], {
        caseTitle: ' RAMÍREZ,\nLUCÍA C/ TRANSPORTES ',
        caseNumber: ' 18.452/2025 ',
        court: ' Juzgado Civil y Comercial N° 7 ',
      }),
      text,
    );

    expect(result.proceedings[0]).toMatchObject({ kind: 'RESOLUCION', title: 'Resolución', description: 'Se corre traslado por 15 días.' });
    expect(result.caseInfo).toEqual({ title: 'RAMÍREZ, LUCÍA C/ TRANSPORTES', number: '18.452/2025', court: 'Juzgado Civil y Comercial N° 7' });
  });

  it('offers at most 100 actuaciones', () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ date: `2025-01-${String((i % 28) + 1).padStart(2, '0')}`, title: `Actuación ${i}` }));
    expect(normalizeAnalysis(raw(many), text).proceedings).toHaveLength(100);
  });

  it('says when the text was cut', () => {
    expect(normalizeAnalysis(raw([]), text, [], true).textTruncated).toBe(true);
    expect(normalizeAnalysis(raw([]), text).textTruncated).toBe(false);
  });
});

describe('buildAnalysisRequest', () => {
  it('sends the text between delimiters that change every time, as data', () => {
    const a = buildAnalysisRequest(text);
    const b = buildAnalysisRequest(text);

    expect(a.truncated).toBe(false);
    expect(a.message).toContain('no instrucciones');
    expect(a.message).toContain('12/03/2025 Escrito presentado: Demanda');
    const tag = /<(texto-[0-9a-f]{8})>/.exec(a.message)![1]!;
    expect(a.message).toContain(`</${tag}>`);
    expect(b.message).not.toContain(tag);
  });

  it('keeps the beginning and the end of a very long text', () => {
    const long = `PRINCIPIO ${'x'.repeat(80_000)} FINAL`;
    const request = buildAnalysisRequest(long);

    expect(request.truncated).toBe(true);
    expect(request.message).toContain('PRINCIPIO');
    expect(request.message).toContain('FINAL');
    expect(request.message).toContain('se omite una parte del texto');
    expect(request.message.length).toBeLessThan(61_000);
  });
});

describe('buildTimeline', () => {
  const proceeding = (id: string, date: string, title: string): ProceedingDto => ({
    id,
    caseId: 'c1',
    date,
    kind: 'ESCRITO',
    title,
    description: '',
    position: 1,
    source: 'MANUAL',
    sourceQuote: '',
    document: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const deadline = (id: string, dueDate: string, title: string) =>
    ({
      id,
      title,
      dueDate,
      status: 'PENDING',
      state: 'ONGOING',
      daysLeft: 10,
      notificationDate: '2025-03-01',
      days: 15,
      dayType: 'BUSINESS',
    }) as unknown as ReturnType<typeof toDeadlineDto>;

  it('puts actuaciones and deadlines in one list, oldest first', () => {
    const items = buildTimeline(
      [proceeding('p1', '2025-03-12', 'Demanda'), proceeding('p2', '2025-05-05', 'Providencia')],
      [deadline('d1', '2025-04-02', 'Contestar traslado')],
    );

    expect(items.map((item) => `${item.type}:${item.id}`)).toEqual(['PROCEEDING:p1', 'DEADLINE:d1', 'PROCEEDING:p2']);
    expect(items[1]).toMatchObject({ date: '2025-04-02', title: 'Contestar traslado', state: 'ONGOING', days: 15 });
  });

  it('on the same day lists the actuaciones first, in their own order, and then the deadlines', () => {
    const items = buildTimeline(
      [proceeding('p1', '2025-03-12', 'Primera'), proceeding('p2', '2025-03-12', 'Segunda')],
      [deadline('d1', '2025-03-12', 'Vence ese día')],
    );

    expect(items.map((item) => item.id)).toEqual(['p1', 'p2', 'd1']);
  });

  it('is empty when there is nothing', () => {
    expect(buildTimeline([], [])).toEqual([]);
  });
});

describe('case and actuación schemas', () => {
  it('createCaseSchema needs only the title and fills the rest', () => {
    expect(createCaseSchema.parse({ title: '  Pérez c/ Gómez  ' })).toEqual({
      title: 'Pérez c/ Gómez',
      number: '',
      court: '',
      practiceArea: null,
      status: 'ACTIVE',
      notes: '',
      clientIds: [],
    });
  });

  it('createCaseSchema rejects an empty title, an unknown status or area, and too many clients', () => {
    expect(createCaseSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createCaseSchema.safeParse({ title: 'x', status: 'ABIERTO' }).success).toBe(false);
    expect(createCaseSchema.safeParse({ title: 'x', practiceArea: 'ASTROLOGIA' }).success).toBe(false);
    expect(createCaseSchema.safeParse({ title: 'x', clientIds: ['no-es-un-id'] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(createCaseSchema.safeParse({ title: 'x', clientIds: eleven }).success).toBe(false);
  });

  it('updateCaseSchema only changes what it is given', () => {
    expect(updateCaseSchema.parse({ status: 'CLOSED' })).toEqual({ status: 'CLOSED' });
    expect(updateCaseSchema.safeParse({}).success).toBe(false);
  });

  it('createProceedingSchema fills the defaults and checks the date and the kind', () => {
    expect(createProceedingSchema.parse({ date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' })).toEqual({
      date: '2025-03-12',
      kind: 'ESCRITO',
      title: 'Demanda',
      description: '',
      documentId: null,
      sourceQuote: '',
      source: 'MANUAL',
    });
    expect(createProceedingSchema.safeParse({ date: '2025-02-30', kind: 'ESCRITO', title: 'x' }).success).toBe(false);
    expect(createProceedingSchema.safeParse({ date: '12/03/2025', kind: 'ESCRITO', title: 'x' }).success).toBe(false);
    expect(createProceedingSchema.safeParse({ date: '2025-03-12', kind: 'CARTA', title: 'x' }).success).toBe(false);
    expect(createProceedingSchema.safeParse({ date: '2025-03-12', kind: 'ESCRITO', title: '' }).success).toBe(false);
  });

  it('the batch takes between 1 and 100 actuaciones, and an update needs at least one field', () => {
    const item = { date: '2025-03-12', kind: 'ESCRITO', title: 'Demanda' };
    expect(createProceedingsBatchSchema.safeParse({ items: [] }).success).toBe(false);
    expect(createProceedingsBatchSchema.safeParse({ items: Array(101).fill(item) }).success).toBe(false);
    expect(createProceedingsBatchSchema.safeParse({ items: Array(100).fill(item) }).success).toBe(true);
    expect(updateProceedingSchema.safeParse({}).success).toBe(false);
    expect(updateProceedingSchema.parse({ title: 'Otro' })).toEqual({ title: 'Otro' });
  });
});
