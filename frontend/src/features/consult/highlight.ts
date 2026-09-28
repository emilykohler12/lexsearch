export interface Quote {
  citedText: string;
  startChar: number | null;
  endChar: number | null;
}

export interface Segment {
  text: string;
  quote: Quote | null;
}

/**
 * Splits a fragment into plain and quoted segments. Uses the exact character offsets
 * returned by the API when they match, and falls back to searching for the text.
 */
export function highlightSegments(content: string, quotes: Quote[]): Segment[] {
  const ranges: Array<{ start: number; end: number; quote: Quote }> = [];

  for (const quote of quotes) {
    const text = quote.citedText.trim();
    if (!text) continue;
    const exactOffsets =
      quote.startChar !== null && quote.endChar !== null && content.slice(quote.startChar, quote.endChar) === quote.citedText;
    const start = exactOffsets ? content.indexOf(text, quote.startChar!) : content.indexOf(text);
    if (start >= 0) ranges.push({ start, end: start + text.length, quote });
  }

  ranges.sort((a, b) => a.start - b.start);
  const segments: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.start < cursor) continue; // overlapping quote: keep the first one
    if (range.start > cursor) segments.push({ text: content.slice(cursor, range.start), quote: null });
    segments.push({ text: content.slice(range.start, range.end), quote: range.quote });
    cursor = range.end;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), quote: null });
  return segments;
}
