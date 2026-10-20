import { describe, expect, it } from 'vitest';
import { buildEstimateRequest, groupRulings, normalizeEstimate, orientationOf, recountEstimate, type ModelEstimate, type RulingText } from '../../src/modules/estimates/estimate-analysis.js';

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const rulings: RulingText[] = [1, 2, 3, 4].map((n) => ({
  documentId: id(n),
  title: `Fallo ${n}`,
  pageStart: 1,
  text: `El tribunal resolvió en el caso ${n} que el empleador no acreditó la causa del despido y condenó a pagar la indemnización.`,
}));

const reading = (number: number, overrides: Partial<ModelEstimate['antecedents'][number]> = {}) => ({
  number,
  comparable: 'SI',
  direction: 'FAVORABLE',
  holding: 'Condenó al empleador.',
  quote: 'el empleador no acreditó la causa del despido',
  similarities: ['Despido sin causa'],
  differences: [],
  ...overrides,
});

describe('orientationOf', () => {
  it('needs three comparable antecedents and a clear majority', () => {
    expect(orientationOf(2, 0, 0)).toBe('INSUFFICIENT');
    expect(orientationOf(0, 0, 3)).toBe('INSUFFICIENT');
    expect(orientationOf(3, 0, 0)).toBe('FAVORABLE');
    expect(orientationOf(0, 3, 0)).toBe('UNFAVORABLE');
    expect(orientationOf(2, 2, 0)).toBe('DIVIDED');
    expect(orientationOf(7, 3, 0)).toBe('FAVORABLE');
    expect(orientationOf(6, 4, 0)).toBe('DIVIDED');
    // One ruling that leans one way, propped up by neutral ones, is not an orientation.
    expect(orientationOf(1, 0, 2)).toBe('INSUFFICIENT');
  });
});

describe('normalizeEstimate', () => {
  it('counts verified comparable antecedents and computes the orientation itself', () => {
    const raw: ModelEstimate = {
      antecedents: [reading(1), reading(2), reading(3, { direction: 'desfavorable' }), reading(4, { comparable: 'NO', direction: 'FAVORABLE' })],
      missingFacts: ['Si hubo intimación previa'],
    };
    const result = normalizeEstimate(raw, rulings);

    expect(result.counts).toEqual({ favorable: 2, unfavorable: 1, neutral: 0, notComparable: 1, unverified: 0 });
    expect(result.orientation).toBe('DIVIDED');
    expect(result.antecedents[3]).toMatchObject({ comparable: 'NO', counted: false });
    expect(result.missingFacts).toEqual(['Si hubo intimación previa']);
  });

  it('does not count a reading whose phrase is not in the ruling, and never shows the model copy', () => {
    const raw: ModelEstimate = {
      antecedents: [reading(1), reading(2, { quote: 'una frase que el fallo nunca dijo' }), reading(3), reading(4)],
      missingFacts: [],
    };
    const result = normalizeEstimate(raw, rulings);

    expect(result.counts.unverified).toBe(1);
    expect(result.counts.favorable).toBe(3);
    expect(result.antecedents[1]).toMatchObject({ quote: '', quoteVerified: false, counted: false });
    expect(result.antecedents[0]!.quote).toBe('el empleador no acreditó la causa del despido');
  });

  it('treats a ruling the model skipped as not comparable and ignores a number that does not exist', () => {
    const result = normalizeEstimate({ antecedents: [reading(1), reading(9)], missingFacts: [] }, rulings);
    expect(result.antecedents).toHaveLength(4);
    expect(result.counts).toMatchObject({ favorable: 1, notComparable: 3 });
    expect(result.orientation).toBe('INSUFFICIENT');
  });
});

describe('short phrases and non comparable rulings', () => {
  it('does not count a phrase too short to prove anything, and forces NEUTRO on a non comparable ruling', () => {
    const result = normalizeEstimate({ antecedents: [reading(1, { quote: 'que el' }), reading(2, { comparable: 'NO', direction: 'FAVORABLE' })], missingFacts: [] }, rulings);
    expect(result.antecedents[0]).toMatchObject({ quote: '', quoteVerified: false, counted: false });
    expect(result.antecedents[1]!.direction).toBe('NEUTRO');
  });
});

describe('groupRulings and buildEstimateRequest', () => {
  it('joins the fragments of a ruling in order and keeps the best-ranked ruling first', () => {
    const grouped = groupRulings([
      { documentId: id(1), documentTitle: 'A', pageStart: 2, ordinal: 5, content: 'segundo' },
      { documentId: id(2), documentTitle: 'B', pageStart: 1, ordinal: 0, content: 'otro' },
      { documentId: id(1), documentTitle: 'A', pageStart: 1, ordinal: 1, content: 'primero' },
    ]);
    expect(grouped.map((r) => r.title)).toEqual(['A', 'B']);
    expect(grouped[0]!.text).toBe('primero\n\nsegundo');
  });

  it('puts every text between delimiters with a random suffix', () => {
    const a = buildEstimateRequest('hechos del caso', 'reclamo', '', rulings);
    const b = buildEstimateRequest('hechos del caso', 'reclamo', '', rulings);
    const tag = /<caso-([0-9a-f]{8})>/.exec(a)![1];
    expect(a).toContain(`</caso-${tag}>`);
    expect(a).toContain(`<antecedente-${tag} n="4"`);
    expect(/<caso-([0-9a-f]{8})>/.exec(b)![1]).not.toBe(tag);
  });
});

describe('recountEstimate', () => {
  it('ignores the totals and the flags the client sent', () => {
    const honest = normalizeEstimate({ antecedents: [reading(1), reading(2, { quote: 'inventada' }), reading(3), reading(4, { direction: 'DESFAVORABLE' })], missingFacts: [] }, rulings);
    const forged = {
      ...honest,
      orientation: 'FAVORABLE' as const,
      counts: { favorable: 9, unfavorable: 0, neutral: 0, notComparable: 0, unverified: 0 },
      antecedents: honest.antecedents.map((antecedent) => ({ ...antecedent, quoteVerified: true, counted: true })),
    };
    const result = recountEstimate(forged);
    // The unverified one has no phrase, so it can't count even if it says it was verified.
    expect(result.counts).toEqual({ favorable: 2, unfavorable: 1, neutral: 0, notComparable: 0, unverified: 1 });
    expect(result.orientation).toBe('DIVIDED');
    expect(result.antecedents[1]!.counted).toBe(false);
  });
});
