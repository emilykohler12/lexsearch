import { Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCase, useClients, useCreateCase, useDeleteCase, useUpdateCase } from '../api/hooks';
import type { Case } from '../api/types';
import { SelectField, TextAreaField, TextField } from '../components/fields';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { Alert, Dialog, Spinner } from '../components/ui';
import { changesFrom, emptyForm, formFromCase, hasEntries, toInput, type CaseForm } from '../features/cases/case-form';
import { ClientPicker } from '../features/cases/ClientPicker';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { CASE_STATUS_LABELS, CASE_STATUSES, PRACTICE_AREA_LABELS, PRACTICE_AREAS } from '../lib/format';

/** The data of an expediente: a new one (`/expedientes/nuevo`) or a saved one (`/expedientes/:id/editar`). */
export function CaseEditorPage() {
  const { id } = useParams();
  const { data: found, isPending, isError, error } = useCase(id);

  return (
    <>
      <Link
        to={id ? `/expedientes/${id}` : '/expedientes'}
        className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink"
      >
        {id ? '← Volver al expediente' : '← Volver a expedientes'}
      </Link>
      {id === undefined ? (
        <CaseEditor found={null} />
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
          {found && <CaseEditor key={found.id} found={found} />}
        </>
      )}
    </>
  );
}

/** Nothing is saved until the lawyer says so. */
function CaseEditor({ found }: { found: Case | null }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formElement = useRef<HTMLFormElement>(null);
  // Set when the page is left on purpose (after saving a new expediente or deleting one), so the warning stays quiet.
  const leaving = useRef(false);
  // "Nuevo expediente" in a client's file arrives here with the client already chosen.
  const [initial] = useState(() => emptyForm(searchParams.get('cliente') ?? ''));
  const [form, setForm] = useState<CaseForm>(() => (found ? formFromCase(found) : initial));
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const create = useCreateCase();
  const update = useUpdateCase();
  const remove = useDeleteCase();
  const { data: clients } = useClients();

  const changes = found ? changesFrom(found, form) : null;
  const dirty = found ? changes !== null : hasEntries(form, initial);
  const saving = create.isPending || update.isPending;
  const saveError = create.isError ? create.error : update.isError ? update.error : null;
  const sortedClients = [...(clients ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));

  /** Saves the pending changes; false when it could not (the reason shows on the page). */
  const save = async ({ redirect = true }: { redirect?: boolean } = {}): Promise<boolean> => {
    if (found && !changes) return true;
    if (saving) return false;
    // The title is required: the browser points at it, as in any form.
    if (!formElement.current?.reportValidity()) return false;
    try {
      if (found) {
        await update.mutateAsync({ id: found.id, ...changes });
      } else {
        // A client that was deleted meanwhile must not be sent.
        const known = new Set(sortedClients.map((client) => client.id));
        const created = await create.mutateAsync(toInput({ ...form, clientIds: form.clientIds.filter((id) => known.has(id)) }));
        if (redirect) {
          leaving.current = true;
          navigate(`/expedientes/${created.id}`, { replace: true });
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
    // Leaving to somewhere else: a new expediente must not also redirect to its own page.
    save: () => save({ redirect: false }),
    leaving,
  });

  const setField = <K extends keyof CaseForm>(key: K, value: CaseForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const deleteCase = () => {
    if (!found) return;
    leaving.current = true;
    remove.mutate(found.id, {
      onSuccess: () => navigate('/expedientes', { replace: true }),
      onError: () => {
        leaving.current = false;
        setConfirmingDelete(false);
      },
    });
  };

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
        <h1 className="text-2xl break-words sm:text-3xl">{found ? found.title : 'Nuevo expediente'}</h1>
      </header>

      {saveError && <Alert tone="error">No se pudo guardar el expediente: {saveError.message}</Alert>}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      <section className="card p-4 sm:p-5" aria-labelledby="case-data-title">
        <h2 id="case-data-title" className="mb-4 text-lg">
          Datos
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <TextField
            label="Carátula"
            className="sm:col-span-2 xl:col-span-4"
            value={form.title}
            maxLength={300}
            required
            onChange={(e) => {
              // Only spaces counts as empty (the browser alone would accept it).
              e.target.setCustomValidity(e.target.value !== '' && e.target.value.trim() === '' ? 'Completá este campo' : '');
              setField('title', e.target.value);
            }}
          />
          <TextField
            label="Número de expediente"
            value={form.number}
            maxLength={60}
            onChange={(e) => setField('number', e.target.value)}
          />
          <TextField
            label="Juzgado o tribunal"
            className="xl:col-span-1"
            value={form.court}
            maxLength={200}
            onChange={(e) => setField('court', e.target.value)}
          />
          <SelectField
            label="Área de práctica"
            value={form.practiceArea}
            onChange={(e) => setField('practiceArea', e.target.value as CaseForm['practiceArea'])}
          >
            <option value="">Sin definir</option>
            {PRACTICE_AREAS.map((area) => (
              <option key={area} value={area}>
                {PRACTICE_AREA_LABELS[area]}
              </option>
            ))}
          </SelectField>
          <SelectField label="Estado" value={form.status} onChange={(e) => setField('status', e.target.value as CaseForm['status'])}>
            {CASE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {CASE_STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>
          <ClientPicker
            className="sm:col-span-2 xl:col-span-4"
            clients={sortedClients}
            selectedIds={form.clientIds}
            onChange={(ids) => setField('clientIds', ids)}
          />
          <TextAreaField
            label="Notas"
            className="sm:col-span-2 xl:col-span-4"
            rows={4}
            value={form.notes}
            maxLength={8000}
            onChange={(e) => setField('notes', e.target.value)}
          />
        </div>
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex items-center justify-end gap-2">
          {found && (
            <button
              type="button"
              className="btn-icon hover:text-red-700"
              onClick={() => setConfirmingDelete(true)}
              disabled={remove.isPending}
              title="Eliminar expediente"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Eliminar expediente</span>
            </button>
          )}
          <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={saving || (found !== null && !dirty)}>
            {saving && <Spinner />}
            {saving ? 'Guardando…' : found && !dirty ? 'Guardado' : 'Guardar'}
          </button>
        </div>
      </div>

      <UnsavedChangesDialog blocker={blocker} saving={saving} onSaveAndLeave={() => void saveAndLeave()} />

      {found && (
        <Dialog
          open={confirmingDelete}
          title="¿Eliminar este expediente?"
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
              <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={deleteCase} disabled={remove.isPending}>
                {remove.isPending && <Spinner />}
                Eliminar
              </button>
            </>
          }
        >
          «{found.title}» se elimina definitivamente
          {found.proceedingCount === 1 && ', junto con su actuación'}
          {found.proceedingCount > 1 && `, junto con sus ${found.proceedingCount} actuaciones`}. Sus plazos se conservan.
        </Dialog>
      )}
    </form>
  );
}
