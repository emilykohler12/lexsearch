import { Pencil } from 'lucide-react';
import { Link, Outlet, useParams } from 'react-router';
import { useCase, useContradictions, useDocuments } from '../api/hooks';
import type { Case, CaseStatus } from '../api/types';
import { SectionTabs, type SectionTab } from '../components/SectionTabs';
import { Alert, PracticeAreaBadge, Spinner } from '../components/ui';
import type { CaseContext } from '../features/cases/case-context';
import { agoText, CASE_STATUS_LABELS, daysBetween, plural, todayInArgentina } from '../lib/format';

const STATUS_STYLES: Record<CaseStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-800 ring-amber-200',
  CLOSED: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** An expediente: its header and its sections. Each section (timeline, documents, contradictions) is a page of its own. */
export function CaseLayoutPage() {
  const { id } = useParams();
  const { data: found, isPending, isError, error } = useCase(id);

  return (
    <>
      <Link to="/expedientes" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a expedientes
      </Link>
      {isPending && (
        <p className="mt-6 flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && (
        <div className="mt-6">
          <Alert tone="error">{error.message}</Alert>
        </div>
      )}
      {found && <CaseShell found={found} />}
    </>
  );
}

function CaseShell({ found }: { found: Case }) {
  const { data: documents } = useDocuments({ caseId: found.id });
  const { data: contradictions } = useContradictions(found.id);

  const stats = [
    plural(found.proceedingCount, 'actuación', 'actuaciones'),
    found.lastProceedingDate && `último movimiento ${agoText(daysBetween(found.lastProceedingDate, todayInArgentina()))}`,
    found.pendingDeadlines > 0 && plural(found.pendingDeadlines, 'plazo pendiente', 'plazos pendientes'),
  ].filter(Boolean);

  const base = `/expedientes/${found.id}`;
  const sections: SectionTab[] = [
    { to: base, label: 'Línea de tiempo', end: true },
    { to: `${base}/documentos`, label: 'Documentos', count: documents?.length },
    { to: `${base}/contradicciones`, label: 'Contradicciones', count: contradictions?.length },
  ];

  return (
    <div className="mt-4 space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl break-words sm:text-3xl">{found.title}</h1>
          {(found.number || found.court) && (
            <p className="mt-1 text-sm break-words text-muted">{[found.number, found.court].filter(Boolean).join(' · ')}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
          <span className={`inline-flex rounded-full px-2 py-0.5 font-medium ring-1 ${STATUS_STYLES[found.status]}`}>
            {CASE_STATUS_LABELS[found.status]}
          </span>
          {found.practiceArea && <PracticeAreaBadge area={found.practiceArea} />}
          {found.clients.map((client) => (
            <Link key={client.id} to={`/clientes/${client.id}`} className="text-sm text-muted underline hover:text-ink">
              {client.fullName}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-sm text-muted">{stats.join(' · ')}</p>
          <Link to={`${base}/editar`} className="btn-secondary min-h-11 sm:min-h-0">
            <Pencil className="size-4" aria-hidden />
            Editar datos
          </Link>
        </div>
      </header>

      <SectionTabs label="Secciones del expediente" tabs={sections} />

      <Outlet key={found.id} context={{ found } satisfies CaseContext} />
    </div>
  );
}
