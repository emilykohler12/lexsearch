import { describe, expect, it } from 'vitest';
import { chunkPages, splitSentences } from '../../src/modules/documents/ingestion/chunking.js';

const sentence = (n: number) =>
  `Esta es la oración número ${n} del contrato, que establece obligaciones claras entre las partes.`;
const paragraphOf = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

describe('splitSentences', () => {
  it('splits on sentence endings', () => {
    expect(splitSentences('Primera oración. Segunda oración. ¿Tercera?')).toEqual([
      'Primera oración.',
      'Segunda oración.',
      '¿Tercera?',
    ]);
  });

  it('does not split after legal abbreviations, titles or initials', () => {
    const text =
      'Conforme el art. 245 de la Ley 20.744, inc. 3, corresponde indemnizar. El Dr. Pérez y la Dra. Gómez firmaron por Acme S.A. El juez J. López resolvió.';
    expect(splitSentences(text)).toEqual([
      'Conforme el art. 245 de la Ley 20.744, inc. 3, corresponde indemnizar.',
      'El Dr. Pérez y la Dra. Gómez firmaron por Acme S.A. El juez J. López resolvió.',
    ]);
  });
});

describe('chunkPages', () => {
  it('returns nothing for empty input', () => {
    expect(chunkPages([])).toEqual([]);
    expect(chunkPages([{ page: 1, text: '   ' }])).toEqual([]);
  });

  it('keeps a short document in a single chunk with its page', () => {
    const chunks = chunkPages([{ page: 3, text: 'ARTÍCULO 1.- Objeto del contrato.' }]);
    expect(chunks).toEqual([
      { ordinal: 0, content: 'ARTÍCULO 1.- Objeto del contrato.', pageStart: 3, pageEnd: 3, charCount: 33 },
    ]);
  });

  it('never exceeds maxChars and numbers chunks in order', () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraphOf(i * 10, 4)).join('\n\n');
    const chunks = chunkPages([{ page: 1, text }], { maxChars: 500, overlapChars: 100, minChars: 250 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const [i, chunk] of chunks.entries()) {
      expect(chunk.ordinal).toBe(i);
      expect(chunk.content.length).toBeLessThanOrEqual(500);
      expect(chunk.charCount).toBe(chunk.content.length);
    }
  });

  it('repeats the end of a chunk at the start of the next one (overlap)', () => {
    const text = paragraphOf(1, 20);
    const chunks = chunkPages([{ page: 1, text }], { maxChars: 400, overlapChars: 150, minChars: 200 });

    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 1; i < chunks.length; i++) {
      const firstSentenceOfNext = splitSentences(chunks[i]!.content)[0]!;
      expect(chunks[i - 1]!.content).toContain(firstSentenceOfNext);
    }
  });

  it('keeps whole paragraphs (e.g. articles) together when they fit', () => {
    const articles = Array.from(
      { length: 6 },
      (_, i) => `ARTÍCULO ${i + 1}.- ${paragraphOf(i * 10, 3)}`,
    );
    const chunks = chunkPages([{ page: 1, text: articles.join('\n\n') }], {
      maxChars: 700,
      overlapChars: 0,
      minChars: 300,
    });

    for (const article of articles) {
      expect(chunks.some((c) => c.content.includes(article))).toBe(true);
    }
  });

  it('tracks page ranges when a chunk spans pages', () => {
    const chunks = chunkPages(
      [
        { page: 1, text: 'Final de la página uno.' },
        { page: 2, text: 'Comienzo de la página dos.' },
      ],
      { maxChars: 1000 },
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ pageStart: 1, pageEnd: 2 });
  });

  it('uses null pages for formats without pages (Word)', () => {
    const [chunk] = chunkPages([{ page: null, text: 'Cláusula primera: objeto.' }]);
    expect(chunk).toMatchObject({ pageStart: null, pageEnd: null });
  });

  it('hard-splits a single huge sentence at word boundaries', () => {
    const text = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = chunkPages([{ page: 1, text }], { maxChars: 300, overlapChars: 50, minChars: 100 });

    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(300);
      expect(chunk.content).not.toMatch(/^\S*palabra\d+\S*palabra/); // no glued words
    }
    // Nothing lost: every word appears in some chunk.
    const all = chunks.map((c) => c.content).join(' ');
    expect(all).toContain('palabra0');
    expect(all).toContain('palabra399');
  });

  it('rejects an overlap as large as the chunk', () => {
    expect(() => chunkPages([{ page: 1, text: 'x' }], { maxChars: 100, overlapChars: 100 })).toThrow();
  });
});
