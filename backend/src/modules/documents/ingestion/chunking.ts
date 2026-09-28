/**
 * Splits document text into overlapping chunks for the RAG index.
 *
 * - Paragraphs (legal articles, clauses) are kept together whenever they fit.
 * - Long paragraphs are split by sentence, never in the middle of "art. 245" & co.
 * - Every chunk remembers which pages it came from, so answers can cite "pág. 12".
 */

export interface PageText {
  /** 1-based page number, or null when the format has no pages (Word, text). */
  page: number | null;
  text: string;
}

export interface TextChunk {
  ordinal: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  charCount: number;
}

export interface ChunkOptions {
  /** Hard limit per chunk. multilingual-e5 reads up to 512 tokens (~1500 chars in Spanish). */
  maxChars: number;
  /** Text repeated from the end of the previous chunk to keep context across the cut. */
  overlapChars: number;
  /** A chunk this long may be closed early to avoid cutting a paragraph in half. */
  minChars: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxChars: 1200,
  overlapChars: 200,
  minChars: 600,
};

interface Unit {
  text: string;
  page: number | null;
  /** First unit of a paragraph: joined with a blank line instead of a space. */
  startsParagraph: boolean;
  /** Length of the whole paragraph this unit opens (only set when startsParagraph). */
  paragraphLength: number;
}

// Abbreviations common in Argentine legal texts, lowercase and without the final dot.
const ABBREVIATIONS = new Set([
  'art', 'arts', 'inc', 'incs', 'ap', 'apart', 'cap', 'tít', 'tit', 'sec', 'párr', 'parr',
  'dr', 'dra', 'dres', 'sr', 'sra', 'sres', 'sras', 'srta', 'lic', 'ing', 'esc', 'prof',
  'cía', 'cia', 'nº', 'n°', 'no', 'núm', 'num', 'pág', 'pag', 'págs', 'pags', 'fs', 'fjs', 'vta',
  'cfr', 'conf', 'ej', 'etc', 'ss', 'sgtes', 'op', 'cit', 'ed', 'vol', 'expte', 'exp', 'excma',
  'sup', 'cám', 'cam', 'civ', 'com', 'lab', 'trab', 'fed', 'nac', 'prov', 'cód', 'cod', 'proc',
  'dto', 'decr', 'res', 'disp', 'bo', 'c', 'cs', 'csjn', 'id', 'ib', 'ibíd', 'ibid', 'ob', 'sa',
  'srl', 'sas', 'av', 'dpto', 'depto', 'tel', 'aprox',
]);

const SENTENCE_BOUNDARY = /(?<=[.!?…])\s+(?=[¿¡("“«]?[\p{Lu}\d])/gu;

/** Splits a paragraph into sentences without breaking after abbreviations or initials. */
export function splitSentences(paragraph: string): string[] {
  const pieces = paragraph.split(SENTENCE_BOUNDARY);
  const sentences: string[] = [];

  for (const piece of pieces) {
    const previous = sentences.at(-1);
    if (previous !== undefined && endsWithAbbreviation(previous)) {
      sentences[sentences.length - 1] = `${previous} ${piece}`;
    } else {
      sentences.push(piece);
    }
  }
  return sentences.map((s) => s.trim()).filter(Boolean);
}

function endsWithAbbreviation(text: string): boolean {
  const lastWord = /(\S+)\.$/u.exec(text)?.[1];
  if (!lastWord) return false;
  const word = lastWord.replace(/^[("“«]+/u, '').toLowerCase();
  // Single letters are initials ("J. Pérez") or list markers; dotted acronyms like "S.A."
  // end with a single letter after splitting on dots.
  const tail = word.split('.').at(-1) ?? word;
  return tail.length === 1 || ABBREVIATIONS.has(word) || ABBREVIATIONS.has(tail);
}

/** Last resort for sentences longer than a chunk: cut at whitespace. */
function hardSplit(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

function toUnits(pages: PageText[], maxChars: number): Unit[] {
  const units: Unit[] = [];
  for (const { page, text } of pages) {
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      const pieces =
        paragraph.length <= maxChars
          ? [paragraph]
          : splitSentences(paragraph).flatMap((s) => hardSplit(s, maxChars));

      pieces.forEach((piece, i) => {
        units.push({
          text: piece,
          page,
          startsParagraph: i === 0,
          paragraphLength: i === 0 ? paragraph.length : 0,
        });
      });
    }
  }
  return units;
}

const separatorBefore = (unit: Unit) => (unit.startsParagraph ? '\n\n' : ' ');

function joinUnits(units: Unit[]): string {
  return units.map((u, i) => (i === 0 ? u.text : separatorBefore(u) + u.text)).join('');
}

export function chunkPages(pages: PageText[], options: Partial<ChunkOptions> = {}): TextChunk[] {
  const opts = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (opts.overlapChars >= opts.maxChars) {
    throw new Error('overlapChars must be smaller than maxChars');
  }

  const units = toUnits(pages, opts.maxChars);
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let currentLength = 0;

  const lengthWith = (unit: Unit) =>
    currentLength + (current.length ? separatorBefore(unit).length : 0) + unit.text.length;

  const closeCurrent = () => {
    groups.push(current);
    // Seed the next chunk with the tail of this one (whole units only).
    const overlap: Unit[] = [];
    let overlapLength = 0;
    for (let i = current.length - 1; i > 0; i--) {
      const unit = current[i]!;
      if (overlapLength + unit.text.length > opts.overlapChars) break;
      overlap.unshift(unit);
      overlapLength += unit.text.length + 1;
    }
    current = overlap;
    currentLength = joinUnits(current).length;
  };

  for (const unit of units) {
    const wouldOverflow = current.length > 0 && lengthWith(unit) > opts.maxChars;
    // Close early instead of splitting a paragraph that would not fit in the remaining space.
    const keepParagraphTogether =
      current.length > 0 &&
      unit.startsParagraph &&
      currentLength >= opts.minChars &&
      currentLength + unit.paragraphLength > opts.maxChars;

    if (wouldOverflow || keepParagraphTogether) {
      closeCurrent();
      // Drop overlap that would still not leave room for the new unit.
      while (current.length > 0 && lengthWith(unit) > opts.maxChars) {
        current.shift();
        currentLength = joinUnits(current).length;
      }
    }
    current.push(unit);
    currentLength = joinUnits(current).length;
  }
  if (current.length > 0) groups.push(current);

  return groups
    .filter((group, i) => i === 0 || !isOnlyOverlap(group, groups[i - 1]!))
    .map((group, ordinal) => {
      const content = joinUnits(group);
      const pageNumbers = group.map((u) => u.page).filter((p): p is number => p !== null);
      return {
        ordinal,
        content,
        pageStart: pageNumbers.length ? Math.min(...pageNumbers) : null,
        pageEnd: pageNumbers.length ? Math.max(...pageNumbers) : null,
        charCount: content.length,
      };
    });
}

/** A trailing group made only of units repeated from the previous chunk adds nothing. */
function isOnlyOverlap(group: Unit[], previous: Unit[]): boolean {
  return group.every((unit) => previous.includes(unit));
}
