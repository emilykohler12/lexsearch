import { CalendarClock, Flag, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCaseTimeline, useDeleteProceeding } from '../api/hooks';
import type { Case, ProceedingTimelineItem, TimelineItem } from '../api/types';
import { Alert, Dialog, Spinner } from '../components/ui';
import { useCaseContext } from '../features/cases/case-context';
import { CaseTimeline } from '../features/cases/CaseTimeline';
import { ProceedingDialog } from '../features/cases/ProceedingDialog';
import { ProceedingImporter } from '../features/cases/ProceedingImporter';

/** More items than this: a button to jump to today is worth showing. */
const LONG_TIMELINE = 6;

/** The «Línea de tiempo» section of an expediente. */
export function CaseTimelinePage() {
  const { found } = useCaseContext();
  const { data, isPending, isError, error } = useCaseTimeline(found.id);

  return (
    <>
      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {data && <CaseTimelineView found={found} items={data.items} today={data.today} />}
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

  // A new deadline from here arrives with the expediente (and its client, when it has just one) already chosen.
  const newDeadline = new URLSearchParams({ expediente: found.id });
  if (found.clients.length === 1) newDeadline.set('cliente', found.clients[0]!.id);

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate({ caseId: found.id, id: deleting.id }, { onSuccess: () => setDeleting(null) });
  };

  return (
    <div className="space-y-6">
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
        {items.length > LONG_TIMELINE && (
          <button
            type="button"
            className="btn-ghost min-h-11 sm:min-h-0"
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
