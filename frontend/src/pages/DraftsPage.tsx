import { ChevronRight, FilePenLine } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useClients, useCreateDraft, useDocuments, useDrafts, useHealth } from '../api/hooks';
import type { DocumentCategory, DraftType } from '../api/types';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { CATEGORIES, CATEGORY_LABELS, DRAFT_TYPE_LABELS, DRAFT_TYPES, formatDate } from '../lib/format';

// Models and briefs first: they are the usual base for a new draft.
const TEMPLATE_ORDER: DocumentCategory[] = ['MODELO', 'ESCRITO', 'LEGISLACION', 'JURISPRUDENCIA', 'DOCTRINA', 'OTRO'];

export function DraftsPage() {
  return (
    <>
      <PageHeader title="Borradores" description="El asistente redacta un primer borrador usando tu biblioteca como referencia." />
      <div className="space-y-6">
        <NewDraftForm />
        <DraftList />
      </div>
    </>
  );
}

function NewDraftForm() {
  const navigate = useNavigate();
  const ids = { type: useId(), client: useId(), title: useId(), template: useId(), facts: useId(), instructions: useId() };
  const [searchParams] = useSearchParams();
  const [documentType, setDocumentType] = useState<DraftType>('CARTA_DOCUMENTO');
  const [title, setTitle] = useState('');
  // "Redactar borrador" in a client's file arrives here with the client already chosen.
  const [clientId, setClientId] = useState(searchParams.get('cliente') ?? '');
  const [templateDocumentId, setTemplateDocumentId] = useState('');
  const [caseDetails, setCaseDetails] = useState('');
  const [instructions, setInstructions] = useState('');
  const [categories, setCategories] = useState<DocumentCategory[]>([]);
  const create = useCreateDraft();
  const { data: health } = useHealth();
  const { data: documents } = useDocuments();
  const { data: clients } = useClients();

  const llmConfigured = health?.llm.configured ?? true;
  const templates = (documents ?? [])
    .filter((d) => d.status === 'READY')
    .sort((a, b) => TEMPLATE_ORDER.indexOf(a.category) - TEMPLATE_ORDER.indexOf(b.category) || a.title.localeCompare(b.title));
  const sortedClients = [...(clients ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  // A client that was deleted (or a stale link) must not be sent.
  const selectedClient = sortedClients.find((c) => c.id === clientId);
  const canSubmit = instructions.trim().length >= 3 && !create.isPending && llmConfigured;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    create.mutate(
      {
        documentType,
        instructions: instructions.trim(),
        caseDetails: caseDetails.trim(),
        ...(title.trim() && { title: title.trim() }),
        ...(selectedClient && { clientId: selectedClient.id }),
        ...(templateDocumentId && { templateDocumentId }),
        ...(categories.length > 0 && { categories }),
      },
      { onSuccess: (draft) => navigate(`/borradores/${draft.id}`) },
    );
  };

  const toggleCategory = (category: DocumentCategory) =>
    setCategories((current) => (current.includes(category) ? current.filter((c) => c !== category) : [...current, category]));

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-4 sm:p-5" aria-labelledby="new-draft-title">
      <h2 id="new-draft-title" className="text-lg">
        Nuevo borrador
      </h2>

      {!llmConfigured && (
        <Alert tone="warning">
          Para redactar borradores hace falta configurar la API key de Gemini (ver el README, sección «Configurar Gemini»).
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <label htmlFor={ids.type} className="label">
            Tipo de documento
          </label>
          <select id={ids.type} className="input" value={documentType} onChange={(e) => setDocumentType(e.target.value as DraftType)}>
            {DRAFT_TYPES.map((type) => (
              <option key={type} value={type}>
                {DRAFT_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.client} className="label">
            Cliente (opcional)
          </label>
          <select id={ids.client} className="input" value={selectedClient?.id ?? ''} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Sin cliente</option>
            {sortedClients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.fullName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.template} className="label">
            Modelo base (opcional)
          </label>
          <select id={ids.template} className="input" value={templateDocumentId} onChange={(e) => setTemplateDocumentId(e.target.value)}>
            <option value="">Sin modelo base</option>
            {templates.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title} · {CATEGORY_LABELS[document.category]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.title} className="label">
            Título (opcional)
          </label>
          <input
            id={ids.title}
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Ej.: CD a Distribuidora Ejemplo"
          />
        </div>
      </div>

      <div>
        <label htmlFor={ids.facts} className="label">
          Datos del caso
        </label>
        <textarea
          id={ids.facts}
          className="input min-h-28 resize-y leading-relaxed"
          value={caseDetails}
          onChange={(e) => setCaseDetails(e.target.value)}
          maxLength={8000}
          placeholder="Partes, DNI, domicilios, fechas, montos…"
        />
      </div>

      <div>
        <label htmlFor={ids.instructions} className="label">
          Qué necesitás
        </label>
        <textarea
          id={ids.instructions}
          className="input min-h-24 resize-y leading-relaxed"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          maxLength={4000}
          placeholder="Ej.: Intimar al empleador a registrar la relación laboral en 30 días, bajo apercibimiento de considerarme despedido."
          required
        />
      </div>

      <fieldset>
        <legend className="sr-only">Buscar respaldo en estos tipos de documento</legend>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Buscar respaldo en:</span>
          {CATEGORIES.map((category) => {
            const selected = categories.includes(category);
            return (
              <button
                key={category}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleCategory(category)}
                className={`rounded-full px-3 py-1.5 text-xs ring-1 transition-colors sm:py-1 ${
                  selected ? 'bg-navy-900 text-white ring-navy-900' : 'bg-white text-muted ring-line hover:text-ink'
                }`}
              >
                {CATEGORY_LABELS[category]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" className="btn-primary min-h-11 sm:min-h-0" disabled={!canSubmit}>
          <FilePenLine className="size-4" aria-hidden />
          Redactar borrador
        </button>
        {create.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
            <Spinner /> Redactando el borrador… puede tardar hasta un minuto.
          </p>
        )}
      </div>
      {create.isError && <Alert tone="error">{create.error.message}</Alert>}
    </form>
  );
}

function DraftList() {
  const { data: drafts, isPending, isError, error } = useDrafts();

  return (
    <section aria-labelledby="drafts-title" className="space-y-3">
      <h2 id="drafts-title" className="text-lg">
        Tus borradores
      </h2>
      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {drafts?.length === 0 && <p className="text-sm text-muted">Todavía no redactaste borradores.</p>}
      {drafts && drafts.length > 0 && (
        <ul className="card divide-y divide-line">
          {drafts.map((draft) => (
            <li key={draft.id}>
              <Link to={`/borradores/${draft.id}`} className="flex items-center gap-4 px-4 py-4 hover:bg-paper/70 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words sm:truncate">{draft.title}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {DRAFT_TYPE_LABELS[draft.documentType]}
                    {draft.client && ` · ${draft.client.fullName}`} · actualizado el {formatDate(draft.updatedAt)}
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
