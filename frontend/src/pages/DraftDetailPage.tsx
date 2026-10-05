import { Check, Copy, Download, ExternalLink, Eye, Pencil, Save, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { useDeleteDraft, useDraft, useUpdateDraft } from '../api/hooks';
import type { Draft, DraftSource } from '../api/types';
import { Alert, Dialog, Spinner } from '../components/ui';
import { countPlaceholders, toPlainText } from '../features/drafts/markdown';
import { MarkdownPreview } from '../features/drafts/MarkdownPreview';
import { DRAFT_TYPE_LABELS, formatDate, formatPages, plural } from '../lib/format';

type Mode = 'preview' | 'edit';
const MODES: Array<{ value: Mode; label: string; icon: LucideIcon }> = [
  { value: 'preview', label: 'Vista previa', icon: Eye },
  { value: 'edit', label: 'Editar', icon: Pencil },
];

type DraftChanges = { title?: string; content?: string };

/** What differs from the saved draft (an emptied title is ignored, not saved). */
function pendingChanges(draft: Draft, title: string, content: string): DraftChanges | null {
  const changes: DraftChanges = {};
  const cleanTitle = title.trim();
  if (cleanTitle && cleanTitle !== draft.title) changes.title = cleanTitle;
  if (content !== draft.content) changes.content = content;
  return Object.keys(changes).length > 0 ? changes : null;
}

function startDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  link.click();
}

export function DraftDetailPage() {
  const { id } = useParams();
  const { data: draft, isPending, isError, error } = useDraft(id);

  return (
    <>
      <Link to="/borradores" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a borradores
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
      {draft && <DraftEditor key={draft.id} draft={draft} />}
    </>
  );
}

function DraftEditor({ draft }: { draft: Draft }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('preview');
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [copied, setCopied] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const { mutateAsync: saveDraft, isPending: saving, isError: saveFailed, error: saveError } = useUpdateDraft();
  const remove = useDeleteDraft();
  // Set when the page is left on purpose (after deleting), so the unsaved-changes warning stays quiet.
  const leaving = useRef(false);

  const changes = pendingChanges(draft, title, content);
  const dirty = changes !== null;
  const placeholders = countPlaceholders(content);

  /** Saves the pending changes; false when it could not (the error shows above the editor). */
  const save = async (): Promise<boolean> => {
    if (!changes) return true;
    if (saving) return false;
    try {
      await saveDraft({ id: draft.id, ...changes });
      return true;
    } catch {
      return false;
    }
  };

  // Ctrl + S (⌘ + S on a Mac) saves the draft instead of opening the browser's "Save page" dialog.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void save();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  // Going to another section with unsaved changes asks first (in the dialog at the end)...
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const saveAndLeave = async () => {
    const saved = await save();
    if (blocker.state !== 'blocked') return;
    if (saved) blocker.proceed();
    else blocker.reset(); // stay: the save error is shown above the editor
  };

  // ...and so does closing or reloading the tab (that question is the browser's own).
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  // The Word file is made from the saved draft, so pending changes are saved first.
  const downloadWord = async () => {
    if (await save()) startDownload(api.draftDocxUrl(draft.id));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toPlainText(content));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };

  const deleteDraft = () => {
    leaving.current = true;
    remove.mutate(draft.id, {
      onSuccess: () => navigate('/borradores', { replace: true }),
      onError: () => {
        leaving.current = false;
        setConfirmingDelete(false);
      },
    });
  };

  return (
    <div className="mt-4 space-y-6">
      <header>
        <textarea
          aria-label="Título del borrador"
          rows={1}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value.replace(/\s*\n\s*/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
              void save();
            }
          }}
          onBlur={() => {
            if (!title.trim()) setTitle(draft.title);
          }}
          className="-mx-1.5 field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1.5 font-serif text-2xl text-ink hover:border-line focus:border-brass-500 focus:outline-none sm:text-3xl"
        />
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{DRAFT_TYPE_LABELS[draft.documentType]}</span>
          <span>· creado el {formatDate(draft.createdAt)}</span>
          {placeholders > 0 && (
            <span className="rounded-sm bg-highlight px-1.5 py-0.5 font-medium text-ink">
              {plural(placeholders, 'dato por completar', 'datos por completar')}
            </span>
          )}
        </p>
      </header>

      {saveFailed && <Alert tone="error">No se pudieron guardar los cambios: {saveError.message}</Alert>}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
          <div role="tablist" aria-label="Modo" className="inline-flex rounded-lg bg-paper p-1 ring-1 ring-line">
            {MODES.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                id={`tab-${value}`}
                aria-selected={mode === value}
                aria-controls="draft-panel"
                onClick={() => setMode(value)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors ${
                  mode === value ? 'bg-white font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
            {(mode === 'edit' || dirty) && (
              <button
                type="button"
                className="btn-primary min-h-10 sm:min-h-0"
                onClick={() => void save()}
                disabled={!dirty || saving}
              >
                {saving ? (
                  <Spinner />
                ) : dirty ? (
                  <Save className="size-4" aria-hidden />
                ) : (
                  <Check className="size-4" aria-hidden />
                )}
                {saving ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado'}
              </button>
            )}
            <button type="button" className="btn-secondary min-h-10 sm:min-h-0" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              <span className="max-sm:sr-only">{copied ? 'Copiado' : 'Copiar'}</span>
            </button>
            <button
              type="button"
              className="btn-secondary min-h-10 sm:min-h-0"
              onClick={() => void downloadWord()}
              disabled={saving}
            >
              <Download className="size-4" aria-hidden />
              <span className="sm:hidden">Word</span>
              <span className="hidden sm:inline">Descargar Word</span>
            </button>
            <button
              type="button"
              className="btn-icon hover:text-red-700"
              onClick={() => setConfirmingDelete(true)}
              disabled={remove.isPending}
              title="Eliminar borrador"
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Eliminar borrador</span>
            </button>
          </div>
        </div>

        <div id="draft-panel" role="tabpanel" aria-labelledby={`tab-${mode}`} className="p-4 sm:p-6 lg:p-8">
          {mode === 'edit' ? (
            <textarea
              aria-label="Texto del borrador"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={200_000}
              spellCheck
              className="input field-sizing-content min-h-[60vh] resize-y font-serif leading-7 sm:text-[15px]"
            />
          ) : content.trim() ? (
            <MarkdownPreview markdown={content} />
          ) : (
            <p className="text-sm text-muted">El borrador está vacío.</p>
          )}
        </div>
      </div>

      <DraftSources draft={draft} />

      <Dialog
        open={blocker.state === 'blocked'}
        title="Tenés cambios sin guardar"
        onClose={() => blocker.reset?.()}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary min-h-11 sm:min-h-0"
              data-autofocus
              onClick={() => blocker.reset?.()}
            >
              Seguir editando
            </button>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => blocker.proceed?.()}>
              Salir sin guardar
            </button>
            <button
              type="button"
              className="btn-primary min-h-11 sm:min-h-0"
              onClick={() => void saveAndLeave()}
              disabled={saving}
            >
              {saving && <Spinner />}
              Guardar y salir
            </button>
          </>
        }
      />

      <Dialog
        open={confirmingDelete}
        title="¿Eliminar este borrador?"
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
            <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={deleteDraft} disabled={remove.isPending}>
              {remove.isPending && <Spinner />}
              Eliminar
            </button>
          </>
        }
      >
        «{draft.title}» se elimina definitivamente.
      </Dialog>
    </div>
  );
}

interface SourceGroup {
  documentId: string;
  documentTitle: string;
  readInFull: boolean;
  fragments: DraftSource[];
}

/** Everything the agent consulted, one entry per document. */
function groupByDocument(sources: DraftSource[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const source of sources) {
    const group = groups.get(source.documentId) ?? {
      documentId: source.documentId,
      documentTitle: source.documentTitle,
      readInFull: false,
      fragments: [],
    };
    if (source.kind === 'document') group.readInFull = true;
    else group.fragments.push(source);
    groups.set(source.documentId, group);
  }
  return [...groups.values()];
}

function DraftSources({ draft }: { draft: Draft }) {
  const groups = groupByDocument(draft.sources);

  return (
    <section aria-labelledby="draft-sources-title" className="space-y-3">
      <h2 id="draft-sources-title" className="text-lg">
        Consultado en tu biblioteca
      </h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">No se encontró material relacionado en tu biblioteca.</p>
      ) : (
        <ul className="grid items-start gap-3 xl:grid-cols-2">
          {groups.map((group) => (
            <li key={group.documentId} className="card p-4">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="leading-snug font-medium break-words">{group.documentTitle}</p>
                  <p className="mt-1 text-xs text-muted">
                    {[
                      group.readInFull && 'Leído completo',
                      group.fragments.length > 0 && plural(group.fragments.length, 'fragmento', 'fragmentos'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <a
                  className="btn-ghost ml-auto min-h-10 shrink-0 text-xs sm:min-h-0"
                  href={api.documentFileUrl(group.documentId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  Ver documento
                </a>
              </div>
              {group.fragments.length > 0 && (
                <details className="mt-2">
                  <summary className="min-h-8 cursor-pointer py-1 text-xs font-medium text-brass-700 hover:underline">
                    Ver fragmentos
                  </summary>
                  <div className="mt-2 space-y-3">
                    {group.fragments.map((fragment) => {
                      const pages = formatPages(fragment.pageStart ?? null, fragment.pageEnd ?? null);
                      return (
                        <blockquote
                          key={fragment.chunkId}
                          className="border-l-2 border-line pl-3 text-sm leading-relaxed break-words whitespace-pre-wrap text-ink/90"
                        >
                          {pages && <span className="mb-1 block text-xs text-muted">{pages}</span>}
                          {fragment.content}
                        </blockquote>
                      );
                    })}
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <details className="card p-4">
        <summary className="cursor-pointer text-sm font-medium">Tu pedido</summary>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="label">Qué necesitabas</dt>
            <dd className="break-words whitespace-pre-wrap">{draft.instructions}</dd>
          </div>
          {draft.caseDetails && (
            <div>
              <dt className="label">Datos del caso</dt>
              <dd className="break-words whitespace-pre-wrap">{draft.caseDetails}</dd>
            </div>
          )}
        </dl>
      </details>
    </section>
  );
}
