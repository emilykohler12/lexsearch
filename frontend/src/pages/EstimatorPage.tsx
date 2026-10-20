import { ChevronRight, Compass, Save, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useAnalyzeEstimate, useCases, useDeleteEstimate, useEstimate, useEstimates, useHealth, useSaveEstimate, useUpdateEstimateNote } from '../api/hooks';
import type { EstimateAnalyzeInput } from '../api/types';
import { Alert, Dialog, PageHeader, Spinner } from '../components/ui';
import { EstimateView } from '../features/estimates/EstimateView';
import { formatDate } from '../lib/format';

const MIN_FACTS_CHARS = 40;

export function EstimatorPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Estimador" description="Qué tan favorables son los fallos de tu biblioteca para un caso parecido." />
      <div className="space-y-6">
        {openId ? <SavedEstimate id={openId} onClose={() => setOpenId(null)} /> : <NewEstimate onSaved={setOpenId} />}
        <EstimateList onOpen={setOpenId} />
      </div>
    </>
  );
}

function NewEstimate({ onSaved }: { onSaved: (id: string) => void }) {
  const ids = { facts: useId(), claim: useId(), case: useId() };
  const [facts, setFacts] = useState('');
  const [claim, setClaim] = useState('');
  const [caseId, setCaseId] = useState('');
  const [sent, setSent] = useState<EstimateAnalyzeInput | null>(null);

  const analyze = useAnalyzeEstimate();
  const save = useSaveEstimate();
  const { data: health } = useHealth();
  const { data: cases } = useCases();
  const llmConfigured = health?.llm.configured ?? true;
  const sortedCases = [...(cases ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  const chosenCase = sortedCases.find((candidate) => candidate.id === caseId);
  const canSubmit = facts.trim().length >= MIN_FACTS_CHARS && !analyze.isPending && llmConfigured;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const input: EstimateAnalyzeInput = { facts: facts.trim(), ...(claim.trim() && { claim: claim.trim() }), ...(chosenCase && { caseId: chosenCase.id }) };
    setSent(input);
    save.reset();
    analyze.mutate(input);
  };

  const proposal = analyze.data;
  const onSave = () => {
    if (!proposal || !sent) return;
    save.mutate({ ...sent, result: proposal.result, model: proposal.model }, { onSuccess: (estimate) => onSaved(estimate.id) });
  };

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="card space-y-4 p-4 sm:p-5" aria-labelledby="new-estimate-title">
        <h2 id="new-estimate-title" className="text-lg">
          Nueva estimación
        </h2>
        {!llmConfigured && <Alert tone="warning">Para estimar hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»).</Alert>}
        <div>
          <label htmlFor={ids.facts} className="label">
            Hechos del caso
          </label>
          <textarea
            id={ids.facts}
            className="input min-h-32 resize-y leading-relaxed"
            value={facts}
            onChange={(e) => setFacts(e.target.value)}
            maxLength={6_000}
            placeholder="Contá los hechos que importan: qué pasó, cuándo y qué prueba hay."
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={ids.claim} className="label">
              Qué se reclama o se defiende (opcional)
            </label>
            <input id={ids.claim} className="input" value={claim} onChange={(e) => setClaim(e.target.value)} maxLength={500} placeholder="Ej.: Indemnización por despido sin causa" />
          </div>
          <div>
            <label htmlFor={ids.case} className="label">
              Expediente (opcional)
            </label>
            <select id={ids.case} className="input" value={chosenCase?.id ?? ''} onChange={(e) => setCaseId(e.target.value)}>
              <option value="">Sin expediente</option>
              {sortedCases.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.title}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={!canSubmit}>
            <Compass className="size-4" aria-hidden />
            Estimar
          </button>
          {analyze.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
              <Spinner /> Buscando fallos parecidos y leyéndolos…
            </p>
          )}
        </div>
        {analyze.isError && <Alert tone="error">{analyze.error.message}</Alert>}
      </form>

      {proposal && !analyze.isPending && (
        <section className="space-y-3" aria-label="Resultado de la estimación">
          <EstimateView label={proposal.label} notice={proposal.notice} result={proposal.result} />
          <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={onSave} disabled={save.isPending}>
            <Save className="size-4" aria-hidden />
            Guardar estimación
          </button>
          {save.isError && <Alert tone="error">{save.error.message}</Alert>}
        </section>
      )}
    </div>
  );
}

function SavedEstimate({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: estimate, isPending, isError, error } = useEstimate(id);
  const updateNote = useUpdateEstimateNote(id);
  const remove = useDeleteEstimate();
  const noteId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (isPending) return <Spinner />;
  if (isError) return <Alert tone="error">{error.message}</Alert>;

  const note = draft ?? estimate.note;
  const dirty = draft !== null && draft !== estimate.note;
  const saveNote = () => {
    if (dirty) updateNote.mutate(note, { onSuccess: () => setDraft(null) });
  };

  return (
    <section className="space-y-4" aria-label="Estimación guardada">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg break-words">{estimate.title}</h2>
          <p className="text-xs text-muted">
            {estimate.case && `${estimate.case.title} · `}guardada el {formatDate(estimate.createdAt)}
          </p>
        </div>
        <button type="button" className="btn-secondary min-h-11 shrink-0 sm:min-h-0" onClick={onClose}>
          Nueva estimación
        </button>
      </div>
      <div className="card p-4">
        <p className="text-xs font-medium text-muted">Hechos</p>
        <p className="mt-1 text-sm whitespace-pre-wrap">{estimate.facts}</p>
        {estimate.claim && <p className="mt-2 text-sm text-muted">Se reclama o defiende: {estimate.claim}</p>}
      </div>
      {estimate.result && estimate.label ? (
        <EstimateView label={estimate.label} notice={estimate.notice} result={estimate.result} />
      ) : (
        <Alert tone="warning">No se pudo leer el resultado guardado.</Alert>
      )}
      <div>
        <label htmlFor={noteId} className="label">
          Tu nota
        </label>
        <textarea id={noteId} className="input min-h-24 resize-y" value={note} maxLength={4_000} onChange={(e) => setDraft(e.target.value)} />
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={saveNote} disabled={!dirty || updateNote.isPending}>
            <Save className="size-4" aria-hidden />
            Guardar nota
          </button>
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-4" aria-hidden />
            Eliminar
          </button>
        </div>
        {updateNote.isError && <Alert tone="error">{updateNote.error.message}</Alert>}
      </div>
      <Dialog
        open={confirmDelete}
        title="¿Eliminar la estimación?"
        onClose={() => setConfirmDelete(false)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </button>
            <button
              type="button"
              data-autofocus
              className="btn-primary min-h-11 sm:min-h-0"
              disabled={remove.isPending}
              onClick={() => remove.mutate(id, { onSuccess: onClose })}
            >
              Eliminar
            </button>
          </>
        }
      >
        Se borra la estimación guardada y tu nota. Los fallos de la biblioteca no se tocan.
      </Dialog>
    </section>
  );
}

function EstimateList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: estimates, isPending, isError, error } = useEstimates();

  return (
    <section aria-labelledby="estimates-title" className="space-y-3">
      <h2 id="estimates-title" className="text-lg">
        Estimaciones guardadas
      </h2>
      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {estimates?.length === 0 && <p className="text-sm text-muted">Todavía no guardaste ninguna estimación.</p>}
      {estimates && estimates.length > 0 && (
        <ul className="card divide-y divide-line">
          {estimates.map((estimate) => (
            <li key={estimate.id}>
              <button type="button" onClick={() => onOpen(estimate.id)} className="flex min-h-11 w-full items-center gap-4 px-4 py-4 text-left hover:bg-paper/70 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words sm:truncate">{estimate.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {estimate.case && `${estimate.case.title} · `}
                    {estimate.label} · {formatDate(estimate.updatedAt)}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
