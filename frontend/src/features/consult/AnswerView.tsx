import { Sparkles } from 'lucide-react';
import { Fragment, useMemo, useState } from 'react';
import type { AnswerBlock, AnswerCitation, AnswerSource } from '../../api/types';
import { SourceCard } from './SourceCard';

/** Renders **bold** inside the model's text; everything else is shown as written. */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function AnswerView({ blocks, sources }: { blocks: AnswerBlock[]; sources: AnswerSource[] }) {
  const [active, setActive] = useState<AnswerCitation | null>(null);

  const quotesBySource = useMemo(() => {
    const map = new Map<number, AnswerCitation[]>();
    for (const citation of blocks.flatMap((b) => b.citations)) {
      map.set(citation.sourceNumber, [...(map.get(citation.sourceNumber) ?? []), citation]);
    }
    return map;
  }, [blocks]);

  const cited = sources.filter((s) => quotesBySource.has(s.number));
  const notCited = sources.filter((s) => !quotesBySource.has(s.number));

  const focus = (citation: AnswerCitation) => {
    setActive(citation);
    const element = document.getElementById(`source-${citation.sourceNumber}`);
    if (!element) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.remove('flash');
    void element.offsetWidth; // restart the CSS animation
    element.classList.add('flash');
  };

  return (
    // The answer takes the full width; the fragments it used go below.
    <article className="space-y-6">
      <div className="card p-4 sm:p-6">
        <p className="mb-3 flex items-center gap-2 text-xs font-semibold tracking-wide text-brass-700 uppercase">
          <Sparkles className="size-3.5" aria-hidden /> Respuesta basada en tu biblioteca
        </p>
        <div className="text-[15px] leading-7 break-words whitespace-pre-wrap">
          {blocks.map((block, i) => {
            // One marker per source in this passage.
            const markers = block.citations.filter(
              (c, index, all) => all.findIndex((other) => other.sourceNumber === c.sourceNumber) === index,
            );
            return (
              <span key={i}>
                <InlineText text={block.text} />
                {markers.map((citation) => (
                  <sup key={citation.sourceNumber} className="ml-0.5">
                    <button
                      type="button"
                      onClick={() => focus(citation)}
                      className="min-w-6 rounded bg-brass-100 px-1.5 py-0.5 text-xs font-semibold text-brass-700 hover:bg-brass-500 hover:text-white sm:min-w-0 sm:text-[11px]"
                      title={
                        citation.citedText
                          ? `Fuente ${citation.sourceNumber}: «${citation.citedText.slice(0, 140)}${citation.citedText.length > 140 ? '…' : ''}»`
                          : `Fuente ${citation.sourceNumber}`
                      }
                      aria-label={`Ver fuente ${citation.sourceNumber}`}
                    >
                      {citation.sourceNumber}
                    </button>
                  </sup>
                ))}
              </span>
            );
          })}
        </div>
      </div>

      {cited.length > 0 && (
        <section aria-labelledby="sources-title" className="space-y-3">
          <h2 id="sources-title" className="text-lg">
            Fuentes citadas
          </h2>
          <div className="grid items-start gap-3 xl:grid-cols-2">
            {cited.map((source) => (
              <SourceCard
                key={source.number}
                number={source.number}
                source={source}
                quotes={quotesBySource.get(source.number)}
                activeQuote={active?.sourceNumber === source.number ? active : null}
              />
            ))}
          </div>
        </section>
      )}

      {notCited.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer py-2 text-sm text-muted hover:text-ink">
            Otros fragmentos consultados que la respuesta no citó ({notCited.length})
          </summary>
          <div className="mt-3 grid items-start gap-3 xl:grid-cols-2">
            {notCited.map((source) => (
              <SourceCard key={source.number} number={source.number} source={source} dimmed collapsible />
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
