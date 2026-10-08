import { ChevronRight, FilePenLine, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  useAnalyzeNotes,
  useClient,
  useClientDrafts,
  useCreateClient,
  useDeleteClient,
  useHealth,
  useUpdateClient,
} from '../api/hooks';
import type { Client, ChecklistItem } from '../api/types';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { Alert, Dialog, PracticeAreaBadge, Spinner } from '../components/ui';
import { ChecklistEditor } from '../features/clients/ChecklistEditor';
import {
  applyProposal,
  changesFrom,
  emptyForm,
  formFromClient,
  toFields,
  type ClientForm,
  type FieldName,
} from '../features/clients/client-form';
import { SelectField, TextAreaField, TextField } from '../features/clients/fields';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import {
  DRAFT_TYPE_LABELS,
  formatDate,
  PERSON_TYPE_LABELS,
  PERSON_TYPES,
  plural,
  PRACTICE_AREA_LABELS,
  PRACTICE_AREAS,
} from '../lib/format';

export function ClientDetailPage() {
  const { id } = useParams();
  const { data: client, isPending, isError, error } = useClient(id);

  return (
    <>
      <Link to="/clientes" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a clientes
      </Link>
      {id === undefined ? (
        <ClientEditor client={null} />
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
          {client && <ClientEditor key={client.id} client={client} />}
        </>
      )}
    </>
  );
}

function analysisNotice(filled: number, documents: number): string {
  const parts: string[] = [];
  if (filled > 0) parts.push(`${filled === 1 ? 'se completó' : 'se completaron'} ${plural(filled, 'dato', 'datos')}`);
  if (documents > 0) {
    parts.push(`${documents === 1 ? 'se agregó' : 'se agregaron'} ${plural(documents, 'documento', 'documentos')} al checklist`);
  }
  if (parts.length === 0) return 'Las notas no aportaron datos nuevos para la ficha.';
  const sentence = parts.join(' y ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}. Revisá los cambios antes de guardar.`;
}

/** The client file: a new one (client = null) or a saved one. Nothing is saved until the lawyer says so. */
function ClientEditor({ client }: { client: Client | null }) {
  const navigate = useNavigate();
  const formElement = useRef<HTMLFormElement>(null);
  // Set when the page is left on purpose (after saving a new client or deleting one), so the warning stays quiet.
  const leaving = useRef(false);
  const [form, setForm] = useState<ClientForm>(() => (client ? formFromClient(client) : emptyForm()));
  // The AI's contributions stand out until the lawyer edits them.
  const [suggested, setSuggested] = useState<ReadonlySet<FieldName>>(() => new Set());
  const [suggestedItems, setSuggestedItems] = useState<ReadonlySet<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const create = useCreateClient();
  const update = useUpdateClient();
  const remove = useDeleteClient();
  const analyze = useAnalyzeNotes();
  const { data: health } = useHealth();

  // The analysis finishes later: it must fill what is empty *then*, not when it started.
  const latestForm = useRef(form);
  useEffect(() => {
    latestForm.current = form;
  });

  const changes = changesFrom(client, form);
  const dirty = changes !== null;
  const saving = create.isPending || update.isPending;
  const saveError = create.isError ? create.error : update.isError ? update.error : null;
  const llmConfigured = health?.llm.configured ?? true;
  const pendingDocuments = form.checklist.filter((item) => !item.done).length;

  /** Saves the pending changes; false when it could not (the reason shows on the page). */
  const save = async ({ redirect = true }: { redirect?: boolean } = {}): Promise<boolean> => {
    if (client && !changes) return true;
    if (saving) return false;
    // Required fields and the email format are checked by the browser, as in any form
    // (also for a new client with nothing typed yet: it points at the name).
    if (!formElement.current?.reportValidity()) return false;
    try {
      if (client) {
        await update.mutateAsync({ id: client.id, ...changes });
      } else {
        const created = await create.mutateAsync(toFields(form));
        if (redirect) {
          leaving.current = true;
          navigate(`/clientes/${created.id}`, { replace: true });
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
    // Leaving to somewhere else: a new client must not also redirect to its own page.
    save: () => save({ redirect: false }),
    leaving,
  });

  const setField = <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setSuggested((current) => {
      if (!current.has(key as FieldName)) return current;
      const next = new Set(current);
      next.delete(key as FieldName);
      return next;
    });
  };

  const changeChecklist = (items: ChecklistItem[], editedId?: string) => {
    setField('checklist', items);
    if (editedId && suggestedItems.has(editedId)) {
      setSuggestedItems((current) => {
        const next = new Set(current);
        next.delete(editedId);
        return next;
      });
    }
  };

  const runAnalysis = async () => {
    setNotice(null);
    let proposal;
    try {
      proposal = await analyze.mutateAsync(form.meetingNotes.trim());
    } catch {
      return; // the error shows under the button
    }
    const applied = applyProposal(latestForm.current, proposal);
    setForm(applied.form);
    setSuggested((current) => new Set([...current, ...applied.filled]));
    setSuggestedItems((current) => new Set([...current, ...applied.addedItemIds]));
    setNotice(analysisNotice(applied.filled.length, applied.addedItemIds.length));
  };

  const deleteClient = () => {
    if (!client) return;
    leaving.current = true;
    remove.mutate(client.id, {
      onSuccess: () => navigate('/clientes', { replace: true }),
      onError: () => {
        leaving.current = false;
        setConfirmingDelete(false);
      },
    });
  };

  const canAnalyze = form.meetingNotes.trim().length >= 20 && !analyze.isPending && llmConfigured;
  const isSuggested = (field: FieldName) => suggested.has(field);

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
        <h1 className="text-2xl break-words sm:text-3xl">{client ? client.fullName : 'Nuevo cliente'}</h1>
        {client && (
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {client.practiceArea && <PracticeAreaBadge area={client.practiceArea} />}
            <span>Creado el {formatDate(client.createdAt)}</span>
          </p>
        )}
      </header>

      {saveError && <Alert tone="error">No se pudo guardar la ficha: {saveError.message}</Alert>}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      <section className="card space-y-3 p-4 sm:p-5" aria-labelledby="notes-title">
        <h2 id="notes-title" className="text-lg">
          Notas de la reunión
        </h2>
        {!llmConfigured && (
          <Alert tone="warning">
            Para completar la ficha con IA hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»).
          </Alert>
        )}
        <textarea
          aria-labelledby="notes-title"
          className="input field-sizing-content max-h-96 min-h-32 resize-y leading-relaxed"
          placeholder="Pegá acá las notas o la transcripción de la primera reunión…"
          value={form.meetingNotes}
          maxLength={60_000}
          onChange={(e) => setField('meetingNotes', e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => void runAnalysis()} disabled={!canAnalyze}>
            {analyze.isPending ? <Spinner /> : <Sparkles className="size-4" aria-hidden />}
            Completar con IA
          </button>
          {analyze.isPending && (
            <span className="text-sm text-muted" aria-live="polite">
              Analizando las notas…
            </span>
          )}
        </div>
        {analyze.isError && <Alert tone="error">{analyze.error.message}</Alert>}
        {notice && (
          <Alert tone="info" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        )}
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="client-title">
        <h2 id="client-title" className="mb-4 text-lg">
          Cliente
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Nombre completo o razón social"
            className="lg:col-span-2"
            value={form.fullName}
            maxLength={200}
            required
            suggested={isSuggested('fullName')}
            onChange={(e) => {
              // Only spaces counts as empty (the browser alone would accept it).
              e.target.setCustomValidity(e.target.value !== '' && e.target.value.trim() === '' ? 'Completá este campo' : '');
              setField('fullName', e.target.value);
            }}
          />
          <SelectField
            label="Tipo de persona"
            value={form.personType}
            suggested={isSuggested('personType')}
            onChange={(e) => setField('personType', e.target.value as ClientForm['personType'])}
          >
            {PERSON_TYPES.map((type) => (
              <option key={type} value={type}>
                {PERSON_TYPE_LABELS[type]}
              </option>
            ))}
          </SelectField>
          <TextField
            label="DNI / CUIT"
            value={form.documentNumber}
            maxLength={40}
            suggested={isSuggested('documentNumber')}
            onChange={(e) => setField('documentNumber', e.target.value)}
          />
          <TextField
            label="Email"
            type="email"
            value={form.email}
            maxLength={200}
            suggested={isSuggested('email')}
            onChange={(e) => setField('email', e.target.value)}
          />
          <TextField
            label="Teléfono"
            type="tel"
            value={form.phone}
            maxLength={60}
            suggested={isSuggested('phone')}
            onChange={(e) => setField('phone', e.target.value)}
          />
          <TextField
            label="Domicilio"
            className="sm:col-span-2 lg:col-span-3"
            value={form.address}
            maxLength={300}
            suggested={isSuggested('address')}
            onChange={(e) => setField('address', e.target.value)}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="counterparty-title">
        <h2 id="counterparty-title" className="mb-4 text-lg">
          Contraparte
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <TextField
            label="Nombre o razón social"
            value={form.counterpartyName}
            maxLength={200}
            suggested={isSuggested('counterpartyName')}
            onChange={(e) => setField('counterpartyName', e.target.value)}
          />
          <TextField
            label="DNI / CUIT"
            value={form.counterpartyDocument}
            maxLength={40}
            suggested={isSuggested('counterpartyDocument')}
            onChange={(e) => setField('counterpartyDocument', e.target.value)}
          />
          <TextField
            label="Domicilio"
            className="sm:col-span-2 lg:col-span-1"
            value={form.counterpartyAddress}
            maxLength={300}
            suggested={isSuggested('counterpartyAddress')}
            onChange={(e) => setField('counterpartyAddress', e.target.value)}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="case-title">
        <h2 id="case-title" className="mb-4 text-lg">
          Caso
        </h2>
        <div className="grid gap-4">
          <SelectField
            label="Área de práctica"
            className="sm:max-w-xs"
            value={form.practiceArea}
            suggested={isSuggested('practiceArea')}
            onChange={(e) => setField('practiceArea', e.target.value as ClientForm['practiceArea'])}
          >
            <option value="">Sin definir</option>
            {PRACTICE_AREAS.map((area) => (
              <option key={area} value={area}>
                {PRACTICE_AREA_LABELS[area]}
              </option>
            ))}
          </SelectField>
          <TextAreaField
            label="Resumen del conflicto"
            className="min-w-0"
            rows={5}
            value={form.conflictSummary}
            maxLength={8000}
            suggested={isSuggested('conflictSummary')}
            onChange={(e) => setField('conflictSummary', e.target.value)}
          />
          <TextAreaField
            label="Pretensión"
            rows={3}
            value={form.claim}
            maxLength={4000}
            suggested={isSuggested('claim')}
            onChange={(e) => setField('claim', e.target.value)}
          />
        </div>
      </section>

      <section className="card p-4 sm:p-5" aria-labelledby="documents-title">
        <h2 id="documents-title" className="mb-4 flex flex-wrap items-baseline gap-x-3 text-lg">
          Documentación que falta
          {form.checklist.length > 0 && (
            <span className="font-sans text-sm text-muted">
              {pendingDocuments === 0
                ? 'Todo reunido'
                : `${plural(pendingDocuments, 'pendiente', 'pendientes')} de ${form.checklist.length}`}
            </span>
          )}
        </h2>
        <ChecklistEditor items={form.checklist} suggestedIds={suggestedItems} onChange={changeChecklist} />
      </section>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center gap-2">
          {client && (
            <Link to={`/borradores?cliente=${client.id}`} className="btn-secondary min-h-11 sm:min-h-0">
              <FilePenLine className="size-4" aria-hidden />
              Redactar borrador
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            {client && (
              <button
                type="button"
                className="btn-icon hover:text-red-700"
                onClick={() => setConfirmingDelete(true)}
                disabled={remove.isPending}
                title="Eliminar cliente"
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Eliminar cliente</span>
              </button>
            )}
            <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={saving || (client !== null && !dirty)}>
              {saving && <Spinner />}
              {saving ? 'Guardando…' : client && !dirty ? 'Guardado' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {client && <ClientDrafts clientId={client.id} />}

      <UnsavedChangesDialog blocker={blocker} saving={saving} onSaveAndLeave={() => void saveAndLeave()} />

      {client && (
        <Dialog
          open={confirmingDelete}
          title="¿Eliminar este cliente?"
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
              <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={deleteClient} disabled={remove.isPending}>
                {remove.isPending && <Spinner />}
                Eliminar
              </button>
            </>
          }
        >
          La ficha de «{client.fullName}» se elimina definitivamente. Sus borradores se conservan.
        </Dialog>
      )}
    </form>
  );
}

/** Drafts written for this client (only shown when there are any). */
function ClientDrafts({ clientId }: { clientId: string }) {
  const { data: drafts } = useClientDrafts(clientId);
  if (!drafts || drafts.length === 0) return null;

  return (
    <section aria-labelledby="client-drafts-title" className="space-y-3">
      <h2 id="client-drafts-title" className="text-lg">
        Borradores de este cliente
      </h2>
      <ul className="card divide-y divide-line">
        {drafts.map((draft) => (
          <li key={draft.id}>
            <Link to={`/borradores/${draft.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words sm:truncate">{draft.title}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {DRAFT_TYPE_LABELS[draft.documentType]} · actualizado el {formatDate(draft.updatedAt)}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
