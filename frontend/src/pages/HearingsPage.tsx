import { ChevronRight, Gavel } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useCases, useCreateHearing, useDocuments, useDrafts, useHealth, useHearings } from '../api/hooks';
import type { HearingInput, HearingMaterialKind, HearingRole } from '../api/types';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { MATERIAL_LABELS, ROLE_LABELS } from '../features/hearings/hearing-labels';
import { CATEGORY_LABELS, formatDate } from '../lib/format';

const MIN_PASTED_CHARS = 40;
const MATERIAL_MODES: HearingMaterialKind[] = ['DRAFT', 'DOCUMENT', 'TEXT'];

export function HearingsPage() {
  return (
    <>
      <PageHeader title="Audiencia" description="Practicá tu argumentación frente a una IA que hace de juez o de abogado de la contraparte." />
      <div className="space-y-6">
        <NewHearingForm />
        <HearingList />
      </div>
    </>
  );
}

/** A choice between a few options, as buttons: the chosen one is filled. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-col gap-2 sm:flex-row">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-11 rounded-lg px-4 py-2 text-left text-sm ring-1 transition-colors sm:text-center ${
                selected ? 'bg-navy-900 font-medium text-white ring-navy-900' : 'bg-white text-muted ring-line hover:text-ink'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NewHearingForm() {
  const navigate = useNavigate();
  const ids = { brief: useId(), title: useId(), text: useId(), case: useId(), position: useId(), focus: useId() };
  const [searchParams] = useSearchParams();

  // «Practicar audiencia» in a draft or an expediente arrives here with it already chosen.
  const [role, setRole] = useState<HearingRole>('JUDGE');
  const [mode, setMode] = useState<HearingMaterialKind>(searchParams.get('borrador') ? 'DRAFT' : 'TEXT');
  const [draftId, setDraftId] = useState(searchParams.get('borrador') ?? '');
  const [documentId, setDocumentId] = useState('');
  const [pastedTitle, setPastedTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [caseId, setCaseId] = useState(searchParams.get('expediente') ?? '');
  const [position, setPosition] = useState('');
  const [focus, setFocus] = useState('');

  const create = useCreateHearing();
  const { data: health } = useHealth();
  const { data: drafts } = useDrafts();
  const { data: documents } = useDocuments();
  const { data: cases } = useCases();

  const llmConfigured = health?.llm.configured ?? true;
  const sortedDrafts = [...(drafts ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const readyDocuments = (documents ?? []).filter((document) => document.status === 'READY').sort((a, b) => a.title.localeCompare(b.title, 'es'));
  const sortedCases = [...(cases ?? [])].sort((a, b) => a.title.localeCompare(b.title, 'es'));
  // A draft or expediente that was deleted (or a stale link) must not be sent.
  const chosenDraft = sortedDrafts.find((draft) => draft.id === draftId);
  const chosenDocument = readyDocuments.find((document) => document.id === documentId);
  const chosenCase = sortedCases.find((candidate) => candidate.id === caseId);

  const hasBrief =
    mode === 'DRAFT' ? Boolean(chosenDraft) : mode === 'DOCUMENT' ? Boolean(chosenDocument) : pastedText.trim().length >= MIN_PASTED_CHARS;
  const canSubmit = hasBrief && !create.isPending && llmConfigured;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    const input: HearingInput = {
      role,
      material:
        mode === 'DRAFT' && chosenDraft
          ? { kind: 'DRAFT', id: chosenDraft.id }
          : mode === 'DOCUMENT' && chosenDocument
            ? { kind: 'DOCUMENT', id: chosenDocument.id }
            : { kind: 'TEXT', ...(pastedTitle.trim() && { title: pastedTitle.trim() }), text: pastedText.trim() },
      ...(chosenCase && { caseId: chosenCase.id }),
      ...(position.trim() && { position: position.trim() }),
      ...(focus.trim() && { focus: focus.trim() }),
    };
    create.mutate(input, { onSuccess: (hearing) => navigate(`/audiencia/${hearing.id}`) });
  };

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-4 sm:p-5" aria-labelledby="new-hearing-title">
      <h2 id="new-hearing-title" className="text-lg">
        Nueva práctica
      </h2>

      {!llmConfigured && (
        <Alert tone="warning">Para practicar una audiencia hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»).</Alert>
      )}

      <Segmented
        label="La IA hace de"
        value={role}
        options={(Object.keys(ROLE_LABELS) as HearingRole[]).map((value) => ({ value, label: ROLE_LABELS[value] }))}
        onChange={setRole}
      />

      <Segmented
        label="Tu escrito"
        value={mode}
        options={MATERIAL_MODES.map((value) => ({ value, label: MATERIAL_LABELS[value] }))}
        onChange={setMode}
      />

      {mode === 'DRAFT' && (
        <div>
          <label htmlFor={ids.brief} className="label">
            Borrador
          </label>
          <select id={ids.brief} className="input" value={chosenDraft?.id ?? ''} onChange={(e) => setDraftId(e.target.value)}>
            <option value="">Elegí un borrador</option>
            {sortedDrafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {draft.title}
              </option>
            ))}
          </select>
          {drafts?.length === 0 && (
            <p className="mt-2 text-sm text-muted">
              Todavía no tenés borradores.{' '}
              <Link to="/borradores" className="underline">
                Redactar uno
              </Link>
            </p>
          )}
        </div>
      )}

      {mode === 'DOCUMENT' && (
        <div>
          <label htmlFor={ids.brief} className="label">
            Documento de la biblioteca
          </label>
          <select id={ids.brief} className="input" value={chosenDocument?.id ?? ''} onChange={(e) => setDocumentId(e.target.value)}>
            <option value="">Elegí un documento</option>
            {readyDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title} · {CATEGORY_LABELS[document.category]}
              </option>
            ))}
          </select>
        </div>
      )}

      {mode === 'TEXT' && (
        <div className="space-y-4">
          <div>
            <label htmlFor={ids.title} className="label">
              Título (opcional)
            </label>
            <input
              id={ids.title}
              className="input"
              value={pastedTitle}
              onChange={(e) => setPastedTitle(e.target.value)}
              maxLength={120}
              placeholder="Ej.: Demanda por despido"
            />
          </div>
          <div>
            <label htmlFor={ids.text} className="label">
              Texto del escrito
            </label>
            <textarea
              id={ids.text}
              className="input min-h-40 resize-y leading-relaxed"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              maxLength={100_000}
              placeholder="Pegá acá tu demanda, tu contestación o tu alegato."
            />
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
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
        <div>
          <label htmlFor={ids.position} className="label">
            A quién representás (opcional)
          </label>
          <input
            id={ids.position}
            className="input"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            maxLength={300}
            placeholder="Ej.: A la inquilina, que es la actora"
          />
        </div>
        <div>
          <label htmlFor={ids.focus} className="label">
            Qué querés practicar (opcional)
          </label>
          <input
            id={ids.focus}
            className="input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            maxLength={300}
            placeholder="Ej.: La prueba del depósito"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={!canSubmit}>
          <Gavel className="size-4" aria-hidden />
          Empezar la audiencia
        </button>
        {create.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner /> La IA está leyendo tu escrito para abrir la audiencia…
          </p>
        )}
      </div>
      {create.isError && <Alert tone="error">{create.error.message}</Alert>}
    </form>
  );
}

function HearingList() {
  const { data: hearings, isPending, isError, error } = useHearings();

  return (
    <section aria-labelledby="hearings-title" className="space-y-3">
      <h2 id="hearings-title" className="text-lg">
        Tus prácticas
      </h2>
      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {hearings?.length === 0 && <p className="text-sm text-muted">Todavía no practicaste ninguna audiencia.</p>}
      {hearings && hearings.length > 0 && (
        <ul className="card divide-y divide-line">
          {hearings.map((hearing) => (
            <li key={hearing.id}>
              <Link to={`/audiencia/${hearing.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words sm:truncate">{hearing.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {hearing.case && `${hearing.case.title} · `}
                    <span className={hearing.status === 'FINISHED' ? 'text-emerald-700' : 'text-amber-700'}>
                      {hearing.status === 'FINISHED' ? 'Terminada' : 'En curso'}
                    </span>{' '}
                    · actualizada el {formatDate(hearing.updatedAt)}
                  </p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
