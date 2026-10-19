import { ExternalLink } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { useNormativeItems } from '../api/hooks';
import type { NormativeEdition } from '../api/types';
import { Alert, Spinner } from '../components/ui';
import { normTitle } from '../features/normative/norm-title';
import { formatLongDay, plural } from '../lib/format';

/** Everything a bulletin published on a day, to browse and search. The norms that touch a followed topic are marked. */
export function NormativaBulletinPage() {
  const [source, setSource] = useState('');
  const [date, setDate] = useState('');
  const [category, setCategory] = useState('');
  const [query, setQuery] = useState('');
  const q = useDeferredValue(query.trim());
  const { data: edition, isPending, isError, error, isFetching } = useNormativeItems({ source: source || undefined, date: date || undefined, q, category });

  if (isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Cargando…
      </p>
    );
  }
  if (isError) return <Alert tone="error">{error.message}</Alert>;

  // The editions and headings belong to one bulletin: choosing another starts from its newest edition.
  const chooseSource = (id: string) => {
    setSource(id);
    setDate('');
    setCategory('');
  };

  return (
    <div className="space-y-4">
      {edition.sources.length > 1 && (
        <div role="tablist" aria-label="Boletín" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-white p-1 ring-1 ring-line">
          {edition.sources.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={edition.source === option.id}
              onClick={() => chooseSource(option.id)}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm transition-colors sm:min-h-9 ${
                edition.source === option.id ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {option.shortLabel}
            </button>
          ))}
        </div>
      )}

      {edition.date === null ? (
        <p className="text-sm text-muted">Todavía no se leyó ninguna edición de este Boletín Oficial.</p>
      ) : (
        <BulletinEdition
          edition={edition}
          fetching={isFetching}
          category={category}
          query={query}
          onDate={setDate}
          onCategory={setCategory}
          onQuery={setQuery}
        />
      )}
    </div>
  );
}

function BulletinEdition({
  edition,
  fetching,
  category,
  query,
  onDate,
  onCategory,
  onQuery,
}: {
  edition: NormativeEdition;
  fetching: boolean;
  category: string;
  query: string;
  onDate: (date: string) => void;
  onCategory: (category: string) => void;
  onQuery: (query: string) => void;
}) {
  const sourceLabel = edition.sources.find((option) => option.id === edition.source)?.shortLabel ?? '';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div>
          <label htmlFor="bulletin-date" className="label">
            Edición
          </label>
          <select id="bulletin-date" className="input" value={edition.date ?? ''} onChange={(e) => onDate(e.target.value)}>
            {edition.dates.map((day) => (
              <option key={day} value={day}>
                {formatLongDay(day)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bulletin-category" className="label">
            Rubro
          </label>
          <select id="bulletin-category" className="input" value={category} onChange={(e) => onCategory(e.target.value)}>
            <option value="">Todos</option>
            {category && !edition.categories.includes(category) && <option value={category}>{category}</option>}
            {edition.categories.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bulletin-search" className="label">
            Buscar
          </label>
          <input
            id="bulletin-search"
            type="search"
            className="input"
            placeholder="Organismo, tipo, número o tema…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
      </div>

      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        {plural(edition.items.length, 'norma', 'normas')}
        {fetching && <Spinner className="size-3" />}
      </p>

      {edition.items.length === 0 ? (
        <p className="text-sm text-muted">Ninguna norma coincide con la búsqueda.</p>
      ) : (
        <ul className="card divide-y divide-line overflow-hidden">
          {edition.items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 px-3 py-3 sm:px-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium break-words">{normTitle(item) || item.kind}</p>
                  {item.alertCount > 0 && (
                    <span className="inline-flex rounded-full bg-brass-50 px-2 py-0.5 text-xs font-medium text-brass-700 ring-1 ring-brass-100">
                      Te interesa
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs break-words text-muted">{item.organism}</p>
                <p className="mt-0.5 text-xs text-muted">{item.category}</p>
                {item.summary && <p className="mt-1.5 text-sm break-words">{item.summary}</p>}
              </div>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="btn-icon shrink-0"
                title={`Abrir en el Boletín Oficial (${sourceLabel})`}
              >
                <ExternalLink className="size-4" aria-hidden />
                <span className="sr-only">
                  Abrir {normTitle(item) || item.kind} en el Boletín Oficial ({sourceLabel})
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
