import { Bell, CalendarOff, Check, ChevronRight, Plus, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  useDeadlines,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUpdateDeadline,
} from '../api/hooks';
import type { Deadline, DeadlineState } from '../api/types';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { DeadlineWhen } from '../features/deadlines/DeadlineWhen';
import { formatDate, formatDay, termText } from '../lib/format';

type Tab = 'PENDING' | 'DONE';

const STRIPE: Record<DeadlineState, string> = {
  OVERDUE: 'bg-red-500',
  TODAY: 'bg-red-500',
  SOON: 'bg-amber-400',
  ONGOING: 'bg-transparent',
  DONE: 'bg-emerald-400',
};

export function PlazosPage() {
  const [tab, setTab] = useState<Tab>('PENDING');
  const pending = useDeadlines({ status: 'PENDING' });
  const done = useDeadlines({ status: 'DONE' });
  const update = useUpdateDeadline();

  const active = tab === 'PENDING' ? pending : done;
  const items = useMemo(() => {
    const list = active.data ?? [];
    // Fulfilled ones: the latest first. Pending ones come sorted by due date from the server.
    return tab === 'DONE' ? [...list].sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')) : list;
  }, [active.data, tab]);

  const tabs: Array<{ value: Tab; label: string; count: number | undefined }> = [
    { value: 'PENDING', label: 'Pendientes', count: pending.data?.length },
    { value: 'DONE', label: 'Cumplidos', count: done.data?.length },
  ];

  return (
    <>
      <PageHeader
        title="Plazos"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link to="/plazos/inhabiles" className="btn-secondary min-h-11 sm:min-h-0">
              <CalendarOff className="size-4" aria-hidden />
              Días inhábiles
            </Link>
            <Link to="/plazos/nuevo" className="btn-primary min-h-11 sm:min-h-0">
              <Plus className="size-4" aria-hidden />
              Nuevo plazo
            </Link>
          </div>
        }
      />

      <div className="space-y-6">
        <Warnings />

        <div role="tablist" aria-label="Estado" className="inline-flex rounded-lg bg-white p-1 ring-1 ring-line">
          {tabs.map(({ value, label, count }) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                tab === value ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
              {count !== undefined && <span className="text-xs text-muted">{count}</span>}
            </button>
          ))}
        </div>

        {update.isError && <Alert tone="error">{update.error.message}</Alert>}

        {active.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Cargando…
          </p>
        )}
        {active.isError && <Alert tone="error">{active.error.message}</Alert>}

        {active.data && items.length === 0 && (
          <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
            <Check className="size-8 text-brass-500" aria-hidden />
            <p className="font-serif text-lg">{tab === 'PENDING' ? 'No tenés plazos pendientes' : 'Todavía no cumpliste plazos'}</p>
            {tab === 'PENDING' && (
              <Link to="/plazos/nuevo" className="text-sm font-medium text-brass-700 underline">
                Cargar un plazo
              </Link>
            )}
          </div>
        )}

        {items.length > 0 && (
          <ul className="card divide-y divide-line overflow-hidden">
            {items.map((deadline) => (
              <DeadlineRow
                key={deadline.id}
                deadline={deadline}
                busy={update.isPending && update.variables?.id === deadline.id}
                onToggle={() => update.mutate({ id: deadline.id, status: deadline.status === 'DONE' ? 'PENDING' : 'DONE' })}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function DeadlineRow({ deadline, busy, onToggle }: { deadline: Deadline; busy: boolean; onToggle: () => void }) {
  const done = deadline.status === 'DONE';
  const details = [deadline.case?.title ?? deadline.caseReference, deadline.client?.fullName].filter(Boolean).join(' · ');

  return (
    <li className="flex items-stretch">
      <span className={`w-1 shrink-0 ${STRIPE[deadline.state]}`} aria-hidden />
      <Link to={`/plazos/${deadline.id}`} className="flex min-w-0 flex-1 items-center gap-4 py-4 pr-2 pl-4 hover:bg-paper/70 sm:pl-5">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{deadline.title}</p>
          {details && <p className="mt-0.5 text-xs break-words text-muted">{details}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            <DeadlineWhen state={deadline.state} daysLeft={deadline.daysLeft} />
            <span>{done && deadline.completedAt ? `Cumplido el ${formatDate(deadline.completedAt)}` : formatDay(deadline.dueDate)}</span>
            <span>{termText(deadline.days, deadline.dayType)}</span>
          </div>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
      </Link>
      <div className="flex items-center pr-2 sm:pr-3">
        <button
          type="button"
          className="btn-icon"
          onClick={onToggle}
          disabled={busy}
          title={done ? 'Reabrir' : 'Marcar como cumplido'}
        >
          {busy ? <Spinner /> : done ? <RotateCcw className="size-4" aria-hidden /> : <Check className="size-4" aria-hidden />}
          <span className="sr-only">{done ? `Reabrir «${deadline.title}»` : `Marcar «${deadline.title}» como cumplido`}</span>
        </button>
      </div>
    </li>
  );
}

/** Warnings the system generated (deadlines about to expire or already past); nothing shows while there are none. */
function Warnings() {
  const { data: warnings } = useNotifications();
  const read = useMarkNotificationRead();
  const readAll = useMarkAllNotificationsRead();
  if (!warnings || warnings.length === 0) return null;

  return (
    <section aria-labelledby="warnings-title" className="card border-amber-200 bg-amber-50/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="warnings-title" className="flex items-center gap-2 text-lg">
          <Bell className="size-4 text-amber-700" aria-hidden />
          Avisos
        </h2>
        {warnings.length > 1 && (
          <button type="button" className="btn-ghost min-h-10 text-xs sm:min-h-0" onClick={() => readAll.mutate()}>
            Marcar todos como leídos
          </button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-amber-200/70">
        {warnings.map((warning) => {
          const urgent = warning.kind === 'DEADLINE_OVERDUE' || warning.kind === 'DEADLINE_TODAY';
          return (
            <li key={warning.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">
                  {warning.deadlineId ? (
                    <Link to={`/plazos/${warning.deadlineId}`} className="hover:underline">
                      {warning.title}
                    </Link>
                  ) : (
                    warning.title
                  )}
                </p>
                <p className={`text-sm ${urgent ? 'font-medium text-red-800' : 'text-amber-900'}`}>{warning.message}</p>
              </div>
              <button
                type="button"
                className="btn-secondary min-h-10 text-xs sm:min-h-0"
                onClick={() => read.mutate(warning.id)}
                disabled={read.isPending}
              >
                Entendido
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
