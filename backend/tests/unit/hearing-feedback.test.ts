import { describe, expect, it } from 'vitest';
import { normalizeFeedback, type ModelFeedback } from '../../src/modules/hearings/hearing-feedback.js';
import { feedbackSchema, parseFeedback } from '../../src/modules/hearings/hearings.schemas.js';

const texts = {
  lawyer: 'Creo que fue por marzo, no me acuerdo bien.\nCuento con el recibo del depósito firmado por el propietario, que acompañé como documental.',
  brief: 'Las llaves se entregaron el 12 de abril de 2026 y el depósito se pagó en efectivo.',
};

const raw = (overrides: Partial<ModelFeedback> = {}): ModelFeedback => ({
  summary: 'Respondiste con seguridad sobre la prueba, pero la fecha quedó imprecisa.',
  strengths: [{ point: 'Señalaste la prueba.', quote: 'el recibo del depósito firmado por el propietario', source: 'ABOGADO' }],
  weaknesses: [
    {
      point: 'La fecha de entrega fue vaga.',
      why: 'La contraparte puede dudar de toda la cronología.',
      quote: 'Creo que fue por marzo, no me acuerdo bien',
      source: 'ABOGADO',
      suggestion: 'Llevá la fecha exacta y el documento que la respalda.',
    },
  ],
  prepare: ['Un resumen cronológico de una hoja.'],
  ...overrides,
});

describe('normalizeFeedback', () => {
  it('keeps the lawyer\'s own wording, not the model\'s copy of it', () => {
    const feedback = normalizeFeedback(raw({ strengths: [{ point: 'Bien.', quote: 'EL RECIBO DEL DEPÓSITO firmado por el propietario', source: 'ABOGADO' }] }), texts);

    expect(feedback.strengths[0]).toMatchObject({
      quote: 'el recibo del depósito firmado por el propietario',
      quoteSource: 'ABOGADO',
      quoteVerified: true,
    });
  });

  it('verifies each phrase and tells where it was found', () => {
    const feedback = normalizeFeedback(raw(), texts);

    expect(feedback.weaknesses[0]).toMatchObject({
      point: 'La fecha de entrega fue vaga.',
      quote: 'Creo que fue por marzo, no me acuerdo bien',
      quoteSource: 'ABOGADO',
      quoteVerified: true,
      why: 'La contraparte puede dudar de toda la cronología.',
      suggestion: 'Llevá la fecha exacta y el documento que la respalda.',
    });
  });

  it('finds a phrase of the brief, and finds it in the other text when the model mixed them up', () => {
    const feedback = normalizeFeedback(
      raw({
        strengths: [{ point: 'Coherente con el escrito.', quote: 'Las llaves se entregaron el 12 de abril de 2026', source: 'ESCRITO' }],
        weaknesses: [{ point: 'Dijo otra fecha.', why: 'Se contradice.', quote: 'Las llaves se entregaron el 12 de abril de 2026', source: 'ABOGADO', suggestion: 'Precisá.' }],
      }),
      texts,
    );

    expect(feedback.strengths[0]).toMatchObject({ quoteSource: 'ESCRITO', quoteVerified: true });
    // Said to be of the lawyer's words, but it is in her brief.
    expect(feedback.weaknesses[0]).toMatchObject({ quoteSource: 'ESCRITO', quoteVerified: true });
  });

  it('shows no phrase that is not in the conversation or the brief', () => {
    const feedback = normalizeFeedback(raw({ strengths: [{ point: 'Bien.', quote: 'Fue una exposición brillante y convincente', source: 'ABOGADO' }] }), texts);

    expect(feedback.strengths[0]).toEqual({ point: 'Bien.', quote: '', quoteSource: null, quoteVerified: false });
  });

  it('accepts a point without a phrase (what is weak is what was not said)', () => {
    const feedback = normalizeFeedback(
      raw({ weaknesses: [{ point: 'No cuantificaste el reclamo.', why: 'El juez preguntó el monto.', quote: '', source: '', suggestion: 'Llevá el cálculo.' }] }),
      texts,
    );

    expect(feedback.weaknesses[0]).toMatchObject({ quote: '', quoteSource: null, quoteVerified: false });
  });

  it('forgives punctuation and accents in the phrase but still shows the original', () => {
    const feedback = normalizeFeedback(
      raw({ strengths: [{ point: 'Bien.', quote: 'cuento con el recibo del deposito firmado por el propietario que acompane como documental', source: 'ABOGADO' }] }),
      texts,
    );

    expect(feedback.strengths[0]).toMatchObject({
      quote: 'Cuento con el recibo del depósito firmado por el propietario, que acompañé como documental',
      quoteVerified: true,
    });
  });

  it('drops the points that say nothing and keeps the lists within their limits', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ point: `Punto ${i + 1}`, why: 'Porque sí.', quote: '', source: '', suggestion: 'Mejorar.' }));

    const feedback = normalizeFeedback(
      raw({
        strengths: [{ point: '  ', quote: '', source: '' }, ...Array.from({ length: 9 }, (_, i) => ({ point: `Fuerte ${i + 1}`, quote: '', source: '' }))],
        weaknesses: many(10),
        prepare: ['', ...Array.from({ length: 9 }, (_, i) => `Cosa ${i + 1}`)],
      }),
      texts,
    );

    expect(feedback.strengths.map((s) => s.point)).toEqual(['Fuerte 1', 'Fuerte 2', 'Fuerte 3', 'Fuerte 4']);
    expect(feedback.weaknesses).toHaveLength(6);
    expect(feedback.prepare).toEqual(['Cosa 1', 'Cosa 2', 'Cosa 3', 'Cosa 4', 'Cosa 5', 'Cosa 6']);
  });

  it('writes lines as one and cuts what is too long', () => {
    const feedback = normalizeFeedback(raw({ summary: `Primera línea.\n\n   Segunda   línea. ${'x'.repeat(2_000)}` }), texts);

    expect(feedback.summary.startsWith('Primera línea. Segunda línea. x')).toBe(true);
    expect(feedback.summary).toHaveLength(800);
  });

  it('produces something the screens can read back', () => {
    expect(feedbackSchema.safeParse(normalizeFeedback(raw(), texts)).success).toBe(true);
  });
});

describe('parseFeedback', () => {
  it('gives back a stored feedback', () => {
    const stored = normalizeFeedback(raw(), texts);
    expect(parseFeedback(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });

  it.each([null, undefined, 'texto', {}, { summary: 1 }, { summary: '', strengths: [], weaknesses: 'no', prepare: [] }])('takes %j as no feedback', (value) => {
    expect(parseFeedback(value)).toBeNull();
  });
});
