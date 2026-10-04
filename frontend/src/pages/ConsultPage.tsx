import { Search, Sparkles, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useAsk, useDocuments, useHealth, useSearch } from '../api/hooks';
import type { DocumentCategory } from '../api/types';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { AnswerView } from '../features/consult/AnswerView';
import { SourceCard } from '../features/consult/SourceCard';
import { CATEGORIES, CATEGORY_LABELS, formatSeconds } from '../lib/format';

const EXAMPLES = [
  '¿Qué plazo hay para contestar la demanda en un juicio ordinario?',
  'Cláusula de rescisión anticipada en contratos de locación comercial',
  '¿Cómo se calcula la indemnización por despido sin causa?',
];

export function ConsultPage() {
  const [question, setQuestion] = useState('');
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const questionId = useId();
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const ask = useAsk();
  const search = useSearch();
  const { data: health } = useHealth();
  const { data: documents } = useDocuments();

  const llmConfigured = health?.llm.configured ?? true;
  const libraryEmpty = documents !== undefined && !documents.some((d) => d.status === 'READY');
  const busy = ask.isPending || search.isPending;
  const canSubmit = question.trim().length >= 3 && !busy;
  const filters = categories.length > 0 ? { categories } : {};
  const hasResults = Boolean(ask.data || search.data || ask.isError || search.isError);

  /** Clears the question, the filters and the results, ready for a new search. */
  const clearSearch = () => {
    ask.reset();
    search.reset();
    setQuestion('');
    setCategories([]);
    questionRef.current?.focus();
  };

  const runAsk = () => {
    search.reset();
    ask.mutate({ question: question.trim(), filters });
  };
  const runSearch = () => {
    ask.reset();
    search.mutate({ query: question.trim(), filters });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (llmConfigured) runAsk();
    else runSearch();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onSubmit(event);
  };

  const toggleCategory = (category: DocumentCategory) =>
    setCategories((current) =>
      current.includes(category) ? current.filter((c) => c !== category) : [...current, category],
    );

  return (
    <>
      <PageHeader
        title="Consultar"
        description="LexSearch busca en tus propios documentos y responde citando el fragmento exacto de cada fuente."
      />

      <div className="space-y-4">
        {libraryEmpty && (
          <Alert tone="info">
            Todavía no hay documentos procesados en tu biblioteca.{' '}
            <Link to="/biblioteca" className="font-medium underline">
              Subí tus primeros documentos
            </Link>{' '}
            para empezar a consultar.
          </Alert>
        )}
        {!llmConfigured && (
          <Alert tone="warning">
            Las respuestas redactadas por IA están desactivadas porque falta configurar la API key de Gemini (ver el
            README, sección «Configurar Gemini»). Mientras tanto podés usar <strong>Buscar</strong> para encontrar los
            fragmentos relevantes.
          </Alert>
        )}

        <form onSubmit={onSubmit} className="card p-4 sm:p-5">
          <label htmlFor={questionId} className="label">
            Tu consulta
          </label>
          <textarea
            id={questionId}
            ref={questionRef}
            className="input min-h-28 resize-y leading-relaxed sm:text-[15px]"
            placeholder="Ej.: ¿Qué requisitos tiene la carta documento para intimar el pago de haberes adeudados?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={2000}
          />

          <fieldset className="mt-3">
            <legend className="sr-only">Buscar solo en estos tipos de documento</legend>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Buscar en:</span>
              {CATEGORIES.map((category) => {
                const selected = categories.includes(category);
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleCategory(category)}
                    className={`rounded-full px-3 py-1.5 text-xs ring-1 transition-colors sm:py-1 ${
                      selected ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-muted ring-line hover:text-ink'
                    }`}
                  >
                    {CATEGORY_LABELS[category]}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={!canSubmit || !llmConfigured}>
              <Sparkles className="size-4" aria-hidden />
              Preguntar a la IA
            </button>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={!canSubmit} onClick={runSearch}>
              <Search className="size-4" aria-hidden />
              Solo buscar
            </button>
            {hasResults && !busy && (
              <button
                type="button"
                className="btn-ghost min-h-11 hover:text-red-700 sm:ml-auto sm:min-h-0"
                onClick={clearSearch}
              >
                <Trash2 className="size-4" aria-hidden />
                Eliminar búsqueda
              </button>
            )}
          </div>
        </form>

        {!question && !ask.data && !search.data && (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-lg border border-dashed border-line px-3 py-2 text-left text-xs text-muted hover:border-brass-500 hover:text-ink"
                onClick={() => setQuestion(example)}
              >
                {example}
              </button>
            ))}
          </div>
        )}

        <div aria-live="polite">
          {ask.isPending && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted">
              <Spinner /> Buscando en tu biblioteca y redactando la respuesta… puede tardar unos segundos.
            </p>
          )}
          {search.isPending && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted">
              <Spinner /> Buscando en tu biblioteca…
            </p>
          )}
          {ask.isError && <Alert tone="error">{ask.error.message}</Alert>}
          {search.isError && <Alert tone="error">{search.error.message}</Alert>}
        </div>

        {ask.data && (
          <AnswerView
            key={ask.data.interactionId}
            blocks={ask.data.blocks}
            sources={ask.data.sources}
            footer={`Modelo: ${ask.data.model} · ${formatSeconds(ask.data.durationMs)}.`}
          />
        )}

        {search.data && (
          <section aria-labelledby="results-title" className="space-y-3">
            <h2 id="results-title" className="text-lg">
              {search.data.length > 0 ? 'Fragmentos más relevantes' : 'No se encontraron fragmentos'}
            </h2>
            {search.data.length === 0 && (
              <p className="text-sm text-muted">Probá con otras palabras o quitando los filtros de tipo de documento.</p>
            )}
            <div className="grid gap-3 xl:grid-cols-2">
              {search.data.map((hit, i) => (
                <SourceCard key={hit.chunkId} number={i + 1} source={hit} collapsible />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
