/**
 * Finds a quote produced by the model inside the fragment it claims to come from.
 * Only quotes that really exist in the source are shown to the lawyer as citations.
 */

export interface QuoteMatch {
  start: number;
  end: number;
}

// Typographic variants the model may "normalize" when copying text.
const EQUIVALENT_CHARS: Record<string, string> = {
  '“': '"',
  '”': '"',
  '«': '"',
  '»': '"',
  '‘': "'",
  '’': "'",
  '–': '-',
  '—': '-',
};

/** Lowercased, single-spaced copy of `text` plus, for each output char, its index in the original. */
function normalizeWithMap(text: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let previousWasSpace = true; // trims leading whitespace

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (/\s/u.test(char)) {
      if (!previousWasSpace) {
        normalized += ' ';
        map.push(i);
        previousWasSpace = true;
      }
      continue;
    }
    normalized += (EQUIVALENT_CHARS[char] ?? char).toLowerCase();
    map.push(i);
    previousWasSpace = false;
  }
  if (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    map.pop();
  }
  return { normalized, map };
}

function cleanQuote(quote: string): string {
  return quote
    .trim()
    .replace(/^["'“”«»‘’]+|["'“”«»‘’]+$/gu, '') // surrounding quotation marks
    .replace(/^(\.\.\.|…)\s*|\s*(\.\.\.|…)$/gu, '') // leading/trailing ellipsis
    .trim();
}

export function locateQuote(content: string, quote: string): QuoteMatch | null {
  const cleaned = cleanQuote(quote);
  if (cleaned.length < 3) return null;

  const exact = content.indexOf(cleaned);
  if (exact >= 0) return { start: exact, end: exact + cleaned.length };

  const source = normalizeWithMap(content);
  // If the model joined two pieces with an ellipsis, the longest piece is still a valid anchor.
  const pieces = cleaned
    .split(/\s*(?:\.\.\.|…)\s*/u)
    .map((piece) => normalizeWithMap(piece).normalized)
    .filter((piece) => piece.length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const piece of pieces) {
    const at = source.normalized.indexOf(piece);
    if (at >= 0) {
      return { start: source.map[at]!, end: source.map[at + piece.length - 1]! + 1 };
    }
  }
  return null;
}
