/**
 * Minimal Markdown reader for drafts: the subset the agent writes (headings, paragraphs,
 * lists, bold/italic). Single line breaks are kept, because in legal documents they matter
 * ("Remitente: …" / "Domicilio: …").
 */

export interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; runs: InlineRun[] }
  | { type: 'paragraph'; lines: InlineRun[][] }
  | { type: 'bullet'; runs: InlineRun[] }
  | { type: 'numbered'; marker: string; runs: InlineRun[] }
  | { type: 'rule' };

/**
 * **bold**, __bold__, *italic*, _italic_. Underscores inside words and signature lines
 * ("________") are left alone.
 */
export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const pattern = /(_{3,})|(\*\*|__)(.+?)\2|(?<![\p{L}\d])([*_])(?!\s)(.+?)(?<!\s)\4(?![\p{L}\d])/gu;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    if (match[1] !== undefined) continue; // a signature line stays in the plain text
    if (match.index > cursor) runs.push({ text: text.slice(cursor, match.index) });
    if (match[3] !== undefined) runs.push({ text: match[3], bold: true });
    else runs.push({ text: match[5]!, italic: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor) });
  return runs.filter((run) => run.text.length > 0);
}

export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraph: InlineRun[][] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    paragraph = [];
  };

  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      flush();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^(\d{1,3}[.)])\s+(.*)$/.exec(trimmed);

    if (heading) {
      flush();
      const level = Math.min(heading[1]!.length, 3) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, runs: parseInline(heading[2]!.replace(/\s+#+$/, '')) });
    } else if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      // Lines of underscores are not rules here: in legal documents they are where people sign.
      flush();
      blocks.push({ type: 'rule' });
    } else if (bullet) {
      flush();
      blocks.push({ type: 'bullet', runs: parseInline(bullet[1]!) });
    } else if (numbered) {
      flush();
      blocks.push({ type: 'numbered', marker: numbered[1]!, runs: parseInline(numbered[2]!) });
    } else {
      paragraph.push(parseInline(trimmed));
    }
  }
  flush();
  return blocks;
}
