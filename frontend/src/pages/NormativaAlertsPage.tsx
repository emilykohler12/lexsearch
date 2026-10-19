import { useState } from 'react';
import { Link } from 'react-router';
import {
  useMarkAllNormativeSeen,
  useNormativeAlerts,
  useNormativeTopics,
  useUpdateNormativeAlert,
} from '../api/hooks';
import { Alert, Spinner } from '../components/ui';
import { AlertCard } from '../features/normative/AlertCard';

type View = 'ACTIVE' | 'DISMISSED';

const VIEW_LABELS: Record<View, string> = { ACTIVE: 'Activas', DISMISSED: 'Descartadas' };

/** The norms that touch a topic the lawyer follows: the new ones first, with why they matter. */
export function NormativaAlertsPage() {
  const [view, setView] = useState<View>('ACTIVE');
  const { data: alerts, isPending, isError, error } = useNormativeAlerts(view);
  const { data: topics } = useNormativeTopics();
  const update = useUpdateNormativeAlert();
  const markAll = useMarkAllNormativeSeen();

  const unseen = (alerts ?? []).filter((alert) => alert.status === 'NEW').length;
  const followsNothing = topics !== undefined && !topics.some((topic) => topic.active);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Novedades" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-white p-1 ring-1 ring-line">
          {(Object.keys(VIEW_LABELS) as View[]).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              onClick={() => setView(name)}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm transition-colors sm:min-h-9 ${
                view === name ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {VIEW_LABELS[name]}
            </button>
          ))}
        </div>

        {unseen > 0 && (
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            {markAll.isPending && <Spinner />}
            Marcar todas como vistas
          </button>
        )}
      </div>

      {(update.isError || markAll.isError) && <Alert tone="error">{(update.error ?? markAll.error)?.message}</Alert>}

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}

      {alerts && alerts.length > 0 && (
        <ul className="space-y-3">
          {alerts.map((alert) => (
            <AlertCard
              key={alert.id}
              alert={alert}
              busy={update.isPending && update.variables?.id === alert.id}
              onStatus={(status) => update.mutate({ id: alert.id, status })}
            />
          ))}
        </ul>
      )}

      {alerts && alerts.length === 0 && view === 'ACTIVE' && (
        followsNothing ? (
          <Alert tone="info">
            Todavía no seguís ningún tema. Elegí las áreas de práctica que te interesan y te aviso cuando salga una norma que las toque.{' '}
            <Link to="/normativa/temas" className="font-medium underline">
              Elegir temas
            </Link>
          </Alert>
        ) : (
          <p className="text-sm text-muted">No hay novedades para tus temas.</p>
        )
      )}
      {alerts && alerts.length === 0 && view === 'DISMISSED' && <p className="text-sm text-muted">No descartaste ninguna novedad.</p>}
    </div>
  );
}
