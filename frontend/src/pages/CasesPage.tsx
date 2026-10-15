import { ChevronRight, FolderKanban, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useCases } from '../api/hooks';
import type { CaseStatus, CaseSummary } from '../api/types';
import { Alert, PageHeader, PracticeAreaBadge, Spinner } from '../components/ui';
import { DeadlineWhen } from '../features/deadlines/DeadlineWhen';
import { agoText, CASE_STATUSES, daysBetween, normalizeText, todayInArgentina } from '../lib/format';

const TAB_LABELS: Record<CaseStatus, string> = { ACTIVE: 'En trámite', PAUSED: 'Paralizados', CLOSED: 'Archivados' };
const EMPTY_TEXT: Record<CaseStatus, string> = {
  ACTIVE: 'No hay expedientes en trámite.',
  PAUSED: 'No hay expedientes paralizados.',
  CLOSED: 'No hay expedientes archivados.',
};

export function CasesPage() {
  const { data: cases, isPending, isError, error } = useCases();
  const [tab, setTab] = useState<CaseStatus>('ACTIVE');
  const [filter, setFilter] = useState('');

  const needle = normalizeText(filter.trim());
  const matching = useMemo(
    () =>
      (cases ?? []).filter(
        (c) =>
          !needle ||
          normalizeText(`${c.title} ${c.number} ${c.court} ${c.clients.map((client) => client.fullName).join(' ')}`).includes(needle),
      ),
    [cases, needle],
  );
  const visible = matching.filter((c) => c.status === tab);
  const count = (status: CaseStatus) => matching.filter((c) => c.status === status).length;
  const today = todayInArgentina();

  return (
    <>
      <PageHeader
        title="Expedientes"
        actions={
          <Link to="/expedientes/nuevo" className="btn-primary min-h-11 sm:min-h-0">
            <Plus className="size-4" aria-hidden />
            Nuevo expediente
          </Link>
        }
      />

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}

      {cases?.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <FolderKanban className="size-8 text-brass-500" aria-hidden />
          <p className="font-serif text-lg">Todavía no cargaste expedientes</p>
          <Link to="/expedientes/nuevo" className="text-sm font-medium text-brass-700 underline">
            Cargar el primero
          </Link>
        </div>
      )}

      {cases && cases.length > 0 && (
        <div className="space-y-4">
          <input
            type="search"
            className="input sm:max-w-md"
            placeholder="Buscar por carátula, número, juzgado o cliente…"
            aria-label="Buscar expedientes"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          <div role="tablist" aria-label="Estado" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-white p-1 ring-1 ring-line">
            {CASE_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={tab === status}
                onClick={() => setTab(status)}
                className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                  tab === status ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                {TAB_LABELS[status]}
                <span className="text-xs text-muted">{count(status)}</span>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="text-sm text-muted">{needle ? 'Ningún expediente coincide con la búsqueda.' : EMPTY_TEXT[tab]}</p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {visible.map((c) => (
                <CaseRow key={c.id} item={c} today={today} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

function CaseRow({ item, today }: { item: CaseSummary; today: string }) {
  const details = [item.number, item.court].filter(Boolean).join(' · ');
  const clients = item.clients.map((client) => client.fullName);
  const clientsText = clients.length > 3 ? `${clients.slice(0, 3).join(', ')} y ${clients.length - 3} más` : clients.join(', ');

  return (
    <li>
      <Link to={`/expedientes/${item.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{item.title}</p>
          {details && <p className="mt-0.5 text-xs break-words text-muted">{details}</p>}
          {clientsText && <p className="mt-0.5 text-xs break-words text-muted">{clientsText}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            {item.practiceArea && <PracticeAreaBadge area={item.practiceArea} />}
            {item.nextDeadline && <DeadlineWhen state={item.nextDeadline.state} daysLeft={item.nextDeadline.daysLeft} />}
            <span>
              {item.lastProceedingDate
                ? `Último movimiento ${agoText(daysBetween(item.lastProceedingDate, today))}`
                : 'Sin actuaciones'}
            </span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
