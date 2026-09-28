/**
 * Cleans raw text extracted from PDFs/Word so that chunking and search work on
 * readable paragraphs. The result uses "\n\n" as the only paragraph separator.
 */

// Lines that are only a page number ("12", "- 12 -", "Página 3 de 10", "pág. 4").
const PAGE_NUMBER_LINE = /^[\s\-–—]*(p[aá]g(?:ina)?\.?\s*)?\d{1,4}(\s*(de|\/)\s*\d{1,4})?[\s\-–—]*$/iu;

// A line ending like this closes a paragraph.
const PARAGRAPH_END = /[.:;!?»”"]$/u;

// A line starting like this opens a new block even if the previous line did not end a sentence.
const BLOCK_START =
  /^(art[íi]culo|art\.|arts\.|cap[íi]tulo|t[íi]tulo|secci[oó]n|considerando|resuelve|visto|fallo|[•·▪\-–—]\s|[a-zñ]\)\s|\d{1,3}[.)°º]\s)/iu;

export function normalizeExtractedText(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/\u00AD/g, '') // soft hyphen
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // zero-width chars
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    // Rejoin words split across lines: "contra-\ntante" -> "contratante".
    .replace(/(\p{L})-\n(\p{Ll})/gu, '$1$2');

  const paragraphs: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed) paragraphs.push(trimmed);
    current = '';
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }
    if (PAGE_NUMBER_LINE.test(line)) continue;

    if (current && (PARAGRAPH_END.test(current) || BLOCK_START.test(line))) {
      flush();
    }
    current = current ? `${current} ${line}` : line;
  }
  flush();

  return paragraphs.join('\n\n');
}
