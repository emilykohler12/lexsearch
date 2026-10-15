import { CircleCheck, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCases, useClients, useCreateDeadlines, useDeadline, useDeleteDeadline, useUpdateDeadline } from '../api/hooks';
import type { Deadline, DeadlineProposal, DeadlineStatus } from '../api/types';
import { SelectField, TextAreaField, TextField } from '../components/fields';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { Alert, Dialog, Spinner } from '../components/ui';
import { findCaseByReference } from '../features/cases/case-match';
import {
  applyProposal,
  changesFrom,
  emptyForm,
  emptyTerm,
  formFromDeadline,
  hasEntries,
  toInputs,
  type DeadlineForm,
  type SharedField,
  type TermRow,
} from '../features/deadlines/deadline-form';
import { DeadlineWhen } from '../features/deadlines/DeadlineWhen';
import { DocumentAnalyzer } from '../features/deadlines/DocumentAnalyzer';
import { TermEditor } from '../features/deadlines/TermEditor';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { formatDate, formatDay, termText, todayInArgentina } from '../lib/format';

export function DeadlineEditorPage() {
  const { id } = useParams();
  const { data: deadline, isPending, isError, error } = useDeadline(id);

  return (
    <>
      <Link to="/plazos" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a plazos
      </Link>
      {id === undefined ? (
        <DeadlineEditor deadline={null} />
      ) : (
        <>
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
          {deadline && <DeadlineEditor key={deadline.id} deadline={deadline} />}
        </>
      )}
    </>
  );
}

/** A new deadline (deadline = null) or a saved one. Nothing is saved until the lawyer says so. */
function DeadlineEditor({ deadline }: { deadline: Deadline | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formElement = useRef<HTMLFormElement>(null);
  // Set when the page is left on purpose (after saving or deleting), so the warning stays quiet.
  const leaving = useRef(false);
  // "Nuevo plazo" in a client's file or in an expediente arrives here with them already chosen.
  const [initial] = useState(() => emptyForm(searchParams.get('cliente') ?? '', searchParams.get('expediente') ?? ''));
  const [form, setForm] = useState<DeadlineForm>(() => (deadline ? formFromDeadline(deadline) : initial));
  // What the AI filled in stands out until the lawyer edits it.
  const [suggested, setSuggested] = useState<ReadonlySet<SharedField>>(() => new Set());
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const create = useCreateDeadlines();
  const update = useUpdateDeadline();
  const remove = useDeleteDeadline();
  const { data: clients } = useClients();
  const { data: cases } = useCases();

  const changes = deadline ? changesFrom(deadline, form) : null;
  const dirty = deadline ? changes !== null : hasEntries(form, initial);
  const saving = create.isPending || update.isPending;
  const saveError = create.isError ? create.error : update.isError ? update.error : null;

  const sortedClients = [...(clients ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  // A client that was deleted (or a stale link) must not be sent.
  const clientId = sortedClients.some((c) => c.id === form.clientId) ? form.clientId : '';
  const sortedCases = [...(cases ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  const caseId = sortedCases.some((c) => c.id === form.caseId) ? form.caseId : '';

  /** Saves the pending changes (and the new status, if given); false when it could not. */
  const save = async ({ redirect = true, status }: { redirect?: boolean; status?: DeadlineStatus } = {}): Promise<boolean> => {
    if (saving) return false;
    if (deadline && !changes && !status) return true;
    // Required fields are checked by the browser, as in any form.
    if (!formElement.current?.reportValidity()) return false;
    try {
      if (deadline) {
        await update.mutateAsync({ id: deadline.id, ...changes, ...(status && { status }) });
      } else {
        await create.mutateAsync(toInputs({ ...form, clientId, caseId }));
        if (redirect) {
          leaving.current = true;
          navigate('/plazos');
        }
      }
      return true;
    } catch {
      return false;
    }
  };

  useSaveShortcut(() => void save());
  const { blocker, saveAndLeave } = useUnsavedChanges({
    dirty,
    saving,
    // Leaving to somewhere else: a new deadline must not also redirect to the list.
    save: () => save({ redirect: false }),
    leaving,
  });

  const setShared = (changes: Partial<Pick<DeadlineForm, 'notificationDate' | 'caseReference' | 'clientId' | 'caseId' | 'notes'>>) => {
    setForm((current) => ({ ...current, ...changes }));
    setSuggested((current) => {
      const edited = (Object.keys(changes) as SharedField[]).filter((key) => current.has(key));
      if (edited.length === 0) return current;
      const next = new Set(current);
      for (const key of edited) next.delete(key);
      return next;
    });
  };

  const setTerm = (key: string, changes: Partial<TermRow>) =>
    setForm((current) => ({
      ...current,
      terms: current.terms.map((row) => (row.key === key ? { ...row, ...changes } : row)),
    }));

  const onAnalyzed = (proposal: DeadlineProposal) => {
    const applied = applyProposal(form, proposal);
    const filled = [...applied.filled];
    // If the cédula names an expediente the lawyer already has (by its number), it is chosen.
    const known = applied.form.caseId === '' ? findCaseByReference(sortedCases, proposal.caseReference) : null;
    if (known) {
      applied.form.caseId = known.id;
      filled.push('caseId');
    }
    setForm(applied.form);
    setSuggested((current) => new Set([...current, ...filled]));
  };

  const deleteDeadline = () => {
    if (!deadline) return;
    leaving.current = true;
    remove.mutate(deadline.id, {
      onSuccess: () => navigate('/plazos', { replace: true }),
      onError: () => {
        leaving.current = false;
        setConfirmingDelete(false);
      },
    });
  };

  const done = deadline?.status === 'DONE';
  const saveLabel = deadline ? (dirty ? 'Guardar' : 'Guardado') : form.terms.length > 1 ? `Guardar ${form.terms.length} plazos` : 'Guardar plazo';

  return (
    <form
      ref={formElement}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="mt-4 space-y-6"
    >
      <header>
        <h1 className="text-2xl break-words sm:text-3xl">{deadline ? deadline.title : 'Nuevo plazo'}</h1>
        {deadline && (
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
            <DeadlineWhen state={deadline.state} daysLeft={deadline.daysLeft} />
            <span>
              {done && deadline.completedAt
                ? `Cumplido el ${formatDate(deadline.completedAt)}`
                : `Vence el ${formatDay(deadline.dueDate)}`}
            </span>
            <span>{termText(deadline.days, deadline.dayType)}</span>
            {deadline.client && (
              <Link to={`/clientes/${deadline.client.id}`} className="underline hover:text-ink">
                {deadline.client.fullName}
              </Link>
            )}
            {deadline.case && (
              <Link to={`/expedientes/${deadline.case.id}`} className="underline hover:text-ink">
                {deadline.case.title}
              </Link>
            )}
          </p>
        )}
      </header>

      {saveError && <Alert tone="error">No se pudo guardar el plazo: {saveError.message}</Alert>}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      {!deadline && <DocumentAnalyzer onAnalyzed={onAnalyzed} />}

      <section className="card p-4 sm:p-5" aria-labelledby="deadline-data-title">
        <h2 id="deadline-data-title" className="mb-4 text-lg">
          Datos
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <TextField
              label="Fecha de notificación"
              type="date"
              required
              value={form.notificationDate}
              suggested={suggested.has('notificationDate')}
              onChange={(e) => setShared({ notificationDate: e.target.value })}
            />
            <button
              type="button"
              className="mt-1 min-h-8 text-xs font-medium text-brass-700 hover:underline"
              onClick={() => setShared({ notificationDate: todayInArgentina() })}
            >
              Poner la fecha de hoy
            </button>
          </div>
          <SelectField
            label="Expediente (opcional)"
            value={caseId}
            suggested={suggested.has('caseId')}
            onChange={(e) => setShared({ caseId: e.target.value })}
          >
            <option value="">Sin expediente</option>
            {sortedCases.map((found) => (
              <option key={found.id} value={found.id}>
                {found.number ? `${found.title} · ${found.number}` : found.title}
              </option>
            ))}
          </SelectField>
          <SelectField label="Cliente (opcional)" value={clientId} onChange={(e) => setShared({ clientId: e.target.value })}>
            <option value="">Sin cliente</option>
            {sortedClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.fullName}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Carátula o referencia"
            value={form.caseReference}
            maxLength={300}
            suggested={suggested.has('caseReference')}
            onChange={(e) => setShared({ caseReference: e.target.value })}
          />
          <TextAreaField
            label="Notas"
            className="md:col-span-2 xl:col-span-4"
            rows={2}
            value={form.notes}
            maxLength={4000}
            onChange={(e) => setShared({ notes: e.target.value })}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="terms-title">
        <h2 id="terms-title" className="mb-4 text-lg">
          {form.terms.length > 1 ? 'Plazos' : 'Plazo'}
        </h2>
        <div className="space-y-4">
          {form.terms.map((row) => (
            <TermEditor
              key={row.key}
              row={row}
              notificationDate={form.notificationDate}
              canRemove={!deadline && form.terms.length > 1}
              onChange={(changes) => setTerm(row.key, changes)}
              onRemove={() => setForm((current) => ({ ...current, terms: current.terms.filter((t) => t.key !== row.key) }))}
            />
          ))}
        </div>
        {!deadline && (
          <button
            type="button"
            className="btn-secondary mt-4 min-h-11 sm:min-h-0"
            onClick={() => setForm((current) => ({ ...current, terms: [...current.terms, emptyTerm()] }))}
          >
            <Plus className="size-4" aria-hidden />
            Agregar otro plazo
          </button>
        )}
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-2">
          {deadline && (
            <button
              type="button"
              className="btn-secondary min-h-11 sm:min-h-0"
              onClick={() => void save({ status: done ? 'PENDING' : 'DONE' })}
              disabled={saving}
            >
              {done ? <RotateCcw className="size-4" aria-hidden /> : <CircleCheck className="size-4" aria-hidden />}
              {done ? 'Reabrir' : 'Marcar como cumplido'}
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {deadline && (
              <button
                type="button"
                className="btn-icon hover:text-red-700"
                onClick={() => setConfirmingDelete(true)}
                disabled={remove.isPending}
                title="Eliminar plazo"
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Eliminar plazo</span>
              </button>
            )}
            <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={saving || (deadline !== null && !dirty)}>
              {saving && <Spinner />}
              {saving ? 'Guardando…' : saveLabel}
            </button>
          </div>
        </div>
      </div>

      <UnsavedChangesDialog blocker={blocker} saving={saving} onSaveAndLeave={() => void saveAndLeave()} />

      {deadline && (
        <Dialog
          open={confirmingDelete}
          title="¿Eliminar este plazo?"
          onClose={() => setConfirmingDelete(false)}
          actions={
            <>
              <button
                type="button"
                className="btn-secondary min-h-11 sm:min-h-0"
                data-autofocus
                onClick={() => setConfirmingDelete(false)}
              >
                Cancelar
              </button>
              <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={deleteDeadline} disabled={remove.isPending}>
                {remove.isPending && <Spinner />}
                Eliminar
              </button>
            </>
          }
        >
          «{deadline.title}» se elimina definitivamente, junto con sus avisos.
        </Dialog>
      )}
    </form>
  );
}
