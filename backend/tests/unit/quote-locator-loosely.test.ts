import { describe, expect, it } from 'vitest';
import { locateQuote, locateQuoteLoosely } from '../../src/modules/llm/quote-locator.js';

const TEXT =
  'VISTO el Expediente Nº EX-2026-41692485- -APN-DGDTEYSS#MCH y CONSIDERANDO: Que las partes pactan nuevas condiciones salariales. ARTICULO 1º.- Declárese homologado el acuerdo obrante en el documento Nº RE-2026-41692035-APN-DGDTEYSS#MCH.';

const sliceOf = (match: { start: number; end: number } | null) => (match ? TEXT.slice(match.start, match.end) : null);

describe('locateQuoteLoosely', () => {
  it('finds a phrase the model copied with other punctuation, and returns the original wording', () => {
    const quote = 'el Expediente N° EX-2026-41692485-APN-DGDTEYSS#MCH y';
    expect(locateQuote(TEXT, quote)).toBeNull(); // the strict check says no…
    expect(sliceOf(locateQuoteLoosely(TEXT, quote))).toBe('el Expediente Nº EX-2026-41692485- -APN-DGDTEYSS#MCH y');
  });

  it('does not care for accents, case, or extra spaces', () => {
    expect(sliceOf(locateQuoteLoosely(TEXT, 'DECLAREse   HOMOLOGADO el acuerdo obrante'))).toBe('Declárese homologado el acuerdo obrante');
  });

  it('does not find a phrase with other words, or the same words in another order', () => {
    expect(locateQuoteLoosely(TEXT, 'Declárese rechazado el acuerdo obrante en el documento')).toBeNull();
    expect(locateQuoteLoosely(TEXT, 'acuerdo homologado Declárese el obrante')).toBeNull();
  });

  it('does not take a very short phrase as proof', () => {
    expect(locateQuoteLoosely(TEXT, 'el acuerdo')).toBeNull();
    expect(locateQuoteLoosely(TEXT, '')).toBeNull();
  });

  it('uses the longest piece when the model joined two with an ellipsis', () => {
    expect(sliceOf(locateQuoteLoosely(TEXT, 'Que las partes pactan nuevas condiciones salariales … texto inventado que no está en la norma'))).toBe('Que las partes pactan nuevas condiciones salariales');
  });

  it('ignores the quotation marks around the phrase', () => {
    expect(sliceOf(locateQuoteLoosely(TEXT, '«Que las partes pactan nuevas condiciones salariales»'))).toBe('Que las partes pactan nuevas condiciones salariales');
  });
});
