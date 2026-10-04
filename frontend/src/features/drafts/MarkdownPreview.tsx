import { Fragment, type ReactNode } from 'react';
import { ITALIC } from './markdown';

/** Bold, italic and highlighted placeholders inside a line. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\[COMPLETAR:?[^\]]*\])/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : part.startsWith('[COMPLETAR') ? (
          <mark key={i} className="rounded-sm bg-highlight px-0.5 font-medium text-ink">
            {part}
          </mark>
        ) : (
          <Fragment key={i}>{part.replace(ITALIC, '$1$2')}</Fragment>
        ),
      )}
    </>
  );
}

/** Renders the draft the way it will look on paper (the subset of Markdown the agent writes). */
export function MarkdownPreview({ markdown }: { markdown: string }) {
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const lines = paragraph;
    nodes.push(
      <p key={nodes.length} className="text-justify">
        {lines.map((line, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            <Inline text={line} />
          </Fragment>
        ))}
      </p>,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const { ordered, items } = list;
    const ListTag = ordered ? 'ol' : 'ul';
    nodes.push(
      <ListTag key={nodes.length} className={`${ordered ? 'list-decimal' : 'list-disc'} space-y-1 pl-6`}>
        {items.map((item, i) => (
          <li key={i}>
            <Inline text={item} />
          </li>
        ))}
      </ListTag>,
    );
    list = null;
  };

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/.exec(line);

    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]!.length;
      const className =
        level === 1 ? 'text-center text-xl font-semibold uppercase' : level === 2 ? 'text-lg font-semibold' : 'font-semibold';
      nodes.push(
        <p key={nodes.length} role="heading" aria-level={Math.min(level, 6)} className={`font-serif ${className}`}>
          <Inline text={heading[2]!} />
        </p>,
      );
    } else if (/^(-{3,}|\*{3,})$/.test(line)) {
      // Lines of underscores stay as text: they are signature lines, as in the Word export.
      flushParagraph();
      flushList();
      nodes.push(<hr key={nodes.length} className="border-line" />);
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]!);
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();

  return <div className="space-y-4 font-serif text-[15px] leading-7 text-ink">{nodes}</div>;
}
