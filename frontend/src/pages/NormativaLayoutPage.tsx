import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router';
import { queryKeys, useNormativeStatus, useNormativeUnread, useRefreshNormative } from '../api/hooks';
import type { NormativeStatus } from '../api/types';
import { SectionTabs } from '../components/SectionTabs';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { formatDate, formatLongDay } from '../lib/format';

/** Normativa: new norms of the national and provincial bulletins that touch what the lawyer follows. Each section is a page of its own. */
export function NormativaLayoutPage() {
  const queryClient = useQueryClient();
  const { data: status } = useNormativeStatus();
  const { data: unread } = useNormativeUnread();
  const { mutate: startRefresh, isPending: starting, isError: failedToStart, error: startError } = useRefreshNormative();
  const wasRunning = useRef(false);
  const asked = useRef(false);

  // The screen opens after a long pause (the computer may have been off): ask for a new check, once.
  useEffect(() => {
    if (status?.stale && !status.running && !asked.current) {
      asked.current = true;
      startRefresh();
    }
  }, [status?.stale, status?.running, startRefresh]);

  // When a check ends, what it found shows up without reloading.
  const running = status?.running ?? false;
  useEffect(() => {
    if (wasRunning.current && !running) void queryClient.invalidateQueries({ queryKey: queryKeys.normative });
    wasRunning.current = running;
  }, [running, queryClient]);

  const busy = starting || running;

  return (
    <>
      <PageHeader
        title="Normativa"
        actions={
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" disabled={busy} onClick={() => startRefresh()}>
            {busy ? <Spinner /> : <RefreshCw className="size-4" aria-hidden />}
            Buscar novedades
          </button>
        }
      />

      <div className="space-y-6">
        {failedToStart && <Alert tone="error">{startError.message}</Alert>}
        <StatusLine status={status} />

        <SectionTabs
          label="Secciones de Normativa"
          tabs={[
            { to: '/normativa', label: 'Novedades', end: true, count: unread },
            { to: '/normativa/boletin', label: 'Boletín' },
            { to: '/normativa/temas', label: 'Temas' },
          ]}
        />

        <Outlet />
      </div>
    </>
  );
}

function StatusLine({ status }: { status: NormativeStatus | undefined }) {
  if (!status) return null;
  if (status.running) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
        <Spinner /> Revisando los boletines oficiales…
      </p>
    );
  }
  return (
    <div className="space-y-3">
      {status.sources
        .filter((source) => source.lastError)
        .map((source) => (
          <Alert key={source.id} tone="warning">
            {source.shortLabel}: no se pudo revisar todo el Boletín Oficial. {source.lastError} Se vuelve a intentar solo.
          </Alert>
        ))}
      <div className="space-y-1 text-sm text-muted">
        <p>{status.lastCheckedAt ? `Última revisión: ${formatDate(status.lastCheckedAt)}` : 'Todavía no se revisaron los boletines oficiales.'}</p>
        {status.sources.some((source) => source.lastEditionDate) && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {status.sources.map((source) => (
              <li key={source.id}>
                {source.shortLabel}: {source.lastEditionDate ? `edición del ${formatLongDay(source.lastEditionDate)}` : 'sin ediciones leídas'}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
