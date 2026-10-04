import { ExternalLink } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { DocumentCategory } from '../../api/types';
import { CategoryBadge } from '../../components/ui';
import { formatPages } from '../../lib/format';
import { highlightSegments, type Quote } from './highlight';

export interface SourceLike {
  documentId: string;
  documentTitle: string;
  category: DocumentCategory;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  matchedBy: Array<'semantic' | 'keyword'>;
}

const MATCH_LABELS = { semantic: 'por significado', keyword: 'por palabras exactas' };

export function SourceCard({
  number,
  source,
  quotes = [],
  activeQuote = null,
  dimmed = false,
  collapsible = false,
}: {
  number: number;
  source: SourceLike;
  quotes?: Quote[];
  activeQuote?: Quote | null;
  dimmed?: boolean;
  /** Show at most 7 lines of the fragment, with a "Ver más" toggle. */
  collapsible?: boolean;
}) {
  const pages = formatPages(source.pageStart, source.pageEnd);
  const segments = highlightSegments(source.content, quotes);
  const textRef = useRef<HTMLQuoteElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const clamped = collapsible && !expanded;

  // The toggle only appears when the text really is longer than 7 lines at the current width:
  // measured right after layout, and again whenever the card changes size.
  useLayoutEffect(() => {
    const element = textRef.current;
    if (!element || !clamped) return;
    const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [clamped, source.content]);

  return (
    <div id={`source-${number}`} className={`card scroll-mt-32 p-4 transition-opacity md:scroll-mt-6 ${dimmed ? 'opacity-75' : ''}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-navy-900 text-xs font-semibold text-white">
          {number}
        </span>
        <div className="min-w-0 flex-1">
          <p className="leading-snug font-medium break-words">{source.documentTitle}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <CategoryBadge category={source.category} />
            {pages && <span>{pages}</span>}
            {source.matchedBy.length > 0 && (
              <span>· encontrado {source.matchedBy.map((m) => MATCH_LABELS[m]).join(' y ')}</span>
            )}
          </div>
        </div>
        <a
          className="btn-ghost ml-auto min-h-10 shrink-0 text-xs sm:min-h-0"
          href={api.documentFileUrl(source.documentId, source.pageStart)}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="size-3.5" aria-hidden />
          Ver documento
        </a>
      </div>
      <blockquote
        ref={textRef}
        className={`mt-3 border-l-2 border-line pl-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink/90 ${
          clamped ? 'line-clamp-7' : ''
        }`}
      >
        {segments.map((segment, i) =>
          segment.quote ? (
            <mark key={i} className={segment.quote === activeQuote ? 'quote-active' : 'quote'}>
              {segment.text}
            </mark>
          ) : (
            <span key={i}>{segment.text}</span>
          ),
        )}
      </blockquote>
      {collapsible && (overflows || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-2 min-h-8 pl-3 text-xs font-medium text-brass-700 hover:underline"
        >
          {expanded ? 'Ver menos' : 'Ver más'}
        </button>
      )}
    </div>
  );
}
