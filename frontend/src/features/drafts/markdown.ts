/** "[COMPLETAR: DNI]" placeholders the lawyer still has to fill in. */
export const PLACEHOLDER = /\[COMPLETAR:?[^\]]*\]/g;

/** *italic* / _italic_ markers, but not underscores inside words or file names. */
export const ITALIC = /(^|[^\p{L}\d])[*_]([^*_\n]+)[*_](?=[^\p{L}\d]|$)/gu;

export function countPlaceholders(markdown: string): number {
  return markdown.match(PLACEHOLDER)?.length ?? 0;
}

/** The draft without Markdown marks, to paste into an email or a chat. */
export function toPlainText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      /^\s*(-{3,}|\*{3,})\s*$/.test(line)
        ? ''
        : line
            .replace(/^\s*#{1,6}\s+/, '')
            .replace(/^(\s*)[-*+]\s+/, '$1• ')
            .replace(/\*\*([^*\n]+)\*\*/g, '$1')
            .replace(ITALIC, '$1$2'),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
