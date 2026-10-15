import { CalendarClock, Flag, Pencil, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCaseTimeline, useDeleteProceeding } from '../api/hooks';
import type { Case, CaseStatus, ProceedingTimelineItem, TimelineItem } from '../api/types';
import { Alert, Dialog, PracticeAreaBadge, Spinner } from '../components/ui';
import { CaseTimeline } from '../features/cases/CaseTimeline';
import { ProceedingDialog } from '../features/cases/ProceedingDialog';
import { ProceedingImporter } from '../features/cases/ProceedingImporter';
import { agoText, CASE_STATUS_LABELS, daysBetween, plural } from '../lib/format';

const STATUS_STYLES: Record<CaseStatus, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  PAUSED: 'bg-amber-50 text-amber-800 ring-amber-200',
  CLOSED: 'bg-slate-100 text-slate-700 ring-slate-200',
};

/** More items than this: a button to jump to today is worth showing. */
const LONG_TIMELINE = 6;

export function CaseTimelinePage() {
  const { id } = useParams();
  const { data, isPending, isError, error } = useCaseTimeline(id);

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
      {data && <CaseTimelineView key={data.case.id} found={data.case} items={data.items} today={data.today} />}
    </>
  );
}

function CaseTimelineView({ found, items, today }: { found: Case; items: TimelineItem[]; today: string }) {
  // The dialog for a new actuación ('new') or for the one being edited.
  const [editing, setEditing] = useState<ProceedingTimelineItem | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProceedingTimelineItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const remove = useDeleteProceeding();

  const stats = [
    plural(found.proceedingCount, 'actuación', 'actuaciones'),
    found.lastProceedingDate && `último movimiento ${agoText(daysBetween(found.lastProceedingDate, today))}`,
    found.pendingDeadlines > 0 && plural(found.pendingDeadlines, 'plazo pendiente', 'plazos pendientes'),
  ].filter(Boolean);

  // A new deadline from here arrives with the expediente (and its client, when it has just one) already chosen.
  const newDeadline = new URLSearchParams({ expediente: found.id });
  if (found.clients.length === 1) newDeadline.set('cliente', found.clients[0]!.id);

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate({ caseId: found.id, id: deleting.id }, { onSuccess: () => setDeleting(null) });
  };

  return (
    <div className="mt-4 space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl break-words sm:text-3xl">{found.title}</h1>
          {(found.number || found.court) && <p className="mt-1 text-sm break-words text-muted">{[found.number, found.court].filter(Boolean).join(' · ')}</p>}
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
        <p className="text-sm text-muted">{stats.join(' · ')}</p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={() => setEditing('new')}>
          <Plus className="size-4" aria-hidden />
          Nueva actuación
        </button>
        <button
          type="button"
          className="btn-secondary min-h-11 sm:min-h-0"
          onClick={() => {
            setNotice(null);
            setImporting(true);
          }}
          disabled={importing}
        >
          <Sparkles className="size-4" aria-hidden />
          Importar con IA
        </button>
        <Link to={`/plazos/nuevo?${newDeadline.toString()}`} className="btn-secondary min-h-11 sm:min-h-0">
          <CalendarClock className="size-4" aria-hidden />
          Nuevo plazo
        </Link>
        <Link to={`/expedientes/${found.id}/editar`} className="btn-secondary min-h-11 sm:min-h-0">
          <Pencil className="size-4" aria-hidden />
          Editar datos
        </Link>
        {items.length > LONG_TIMELINE && (
          <button
            type="button"
            className="btn-ghost col-span-2 min-h-11 sm:col-span-1 sm:min-h-0"
            onClick={() => document.getElementById('hoy')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
          >
            <Flag className="size-4" aria-hidden />
            Ir a hoy
          </button>
        )}
      </div>

      {notice && (
        <Alert tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      {importing && (
        <ProceedingImporter
          found={found}
          onClose={() => setImporting(false)}
          onDone={(message) => {
            setImporting(false);
            setNotice(message);
          }}
        />
      )}

      {items.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="font-serif text-lg">Todavía no hay actuaciones</p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm font-medium text-brass-700">
            <button type="button" className="min-h-9 underline" onClick={() => setEditing('new')}>
              Agregar una
            </button>
            <button type="button" className="min-h-9 underline" onClick={() => setImporting(true)}>
              Importarlas con IA
            </button>
          </div>
        </div>
      ) : (
        <CaseTimeline items={items} today={today} onEdit={setEditing} onDelete={setDeleting} />
      )}

      {editing && (
        <ProceedingDialog
          key={editing === 'new' ? 'new' : editing.id}
          caseId={found.id}
          editing={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      <Dialog
        open={deleting !== null}
        title="¿Eliminar esta actuación?"
        onClose={() => setDeleting(null)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => setDeleting(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending && <Spinner />}
              Eliminar
            </button>
          </>
        }
      >
        {deleting && <>«{deleting.title}» se elimina definitivamente de la línea de tiempo.</>}
      </Dialog>
    </div>
  );
}
