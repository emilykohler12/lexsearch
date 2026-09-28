import { describe, expect, it } from 'vitest';
import { normalizeExtractedText } from '../../src/modules/documents/ingestion/text-normalization.js';

describe('normalizeExtractedText', () => {
  it('joins lines of the same paragraph and breaks after a sentence ends', () => {
    const raw = 'El trabajador tendrá derecho a una\nindemnización equivalente a un mes\nde sueldo.\nLa base no podrá exceder el tope.';
    expect(normalizeExtractedText(raw)).toBe(
      'El trabajador tendrá derecho a una indemnización equivalente a un mes de sueldo.\n\nLa base no podrá exceder el tope.',
    );
  });

  it('rejoins words hyphenated across lines', () => {
    expect(normalizeExtractedText('La parte contra-\ntante se obliga.')).toBe('La parte contratante se obliga.');
  });

  it('starts a new paragraph at article headings and list items', () => {
    const raw = 'Disposiciones generales\nARTÍCULO 1.- Objeto\na) primer inciso\nb) segundo inciso';
    expect(normalizeExtractedText(raw).split('\n\n')).toEqual([
      'Disposiciones generales',
      'ARTÍCULO 1.- Objeto',
      'a) primer inciso',
      'b) segundo inciso',
    ]);
  });

  it('drops page-number lines and invisible characters', () => {
    const raw = 'Texto de la página.\n- 12 -\nPágina 3 de 10\nOtro\u00ADtexto\u200B final.';
    expect(normalizeExtractedText(raw)).toBe('Texto de la página.\n\nOtrotexto final.');
  });

  it('keeps blank lines as paragraph separators (Word output)', () => {
    expect(normalizeExtractedText('CLÁUSULA PRIMERA\n\nObjeto del contrato')).toBe(
      'CLÁUSULA PRIMERA\n\nObjeto del contrato',
    );
  });
});
