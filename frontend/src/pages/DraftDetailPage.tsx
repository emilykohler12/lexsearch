import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, Eye, Pencil, Trash2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api } from '../api/client';
import { queryKeys, useDeleteDraft, useDraft, useUpdateDraft } from '../api/hooks';
import type { Draft, DraftSource } from '../api/types';
import { Alert, Spinner } from '../components/ui';
import { countPlaceholders, toPlainText } from '../features/drafts/markdown';
import { MarkdownPreview } from '../features/drafts/MarkdownPreview';
import { DRAFT_TYPE_LABELS, formatDate, formatPages, plural } from '../lib/format';

/** Pause in typing after which changes are saved; longer while the server keeps failing. */
const AUTOSAVE_DELAY_MS = 1_000;
const RETRY_DELAY_MS = 10_000;

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
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('preview');
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  const [copied, setCopied] = useState(false);
  const {
    mutate: save,
    mutateAsync: saveNow,
    isPending: saving,
    isSuccess: savedOnce,
    isError: saveFailed,
    error: saveError,
  } = useUpdateDraft();
  const remove = useDeleteDraft();
  const deleted = useRef(false);
  const unsaved = useRef<DraftChanges | null>(null);

  const changes = pendingChanges(draft, title, content);
  const busy = saving || changes !== null;
  const placeholders = countPlaceholders(content);

  // Autosave once typing pauses.
  useEffect(() => {
    if (saving) return;
    const next = pendingChanges(draft, title, content);
    if (!next) return;
    const timer = setTimeout(() => save({ id: draft.id, ...next }), saveFailed ? RETRY_DELAY_MS : AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, title, content, saving, saveFailed, save]);

  // Changes typed just before leaving the page are saved on the way out.
  useEffect(() => {
    unsaved.current = pendingChanges(draft, title, content);
  });
  useEffect(() => {
    const id = draft.id;
    return () => {
      const last = unsaved.current;
      if (!last || deleted.current) return;
      void api
        .updateDraft(id, last)
        .then((saved) => {
          queryClient.setQueryData(queryKeys.draft(id), saved);
          return queryClient.invalidateQueries({ queryKey: queryKeys.drafts, exact: true });
        })
        .catch(() => undefined);
    };
  }, [draft.id, queryClient]);

  // Closing the tab during the autosave pause would lose the last keystrokes.
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const downloadWord = async () => {
    if (changes) {
      try {
        await saveNow({ id: draft.id, ...changes });
      } catch {
        return; // the save error is already on screen
      }
    }
    startDownload(api.draftDocxUrl(draft.id));
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

  const confirmDelete = () => {
    if (!window.confirm(`¿Eliminar el borrador «${draft.title}»? No se puede deshacer.`)) return;
    deleted.current = true;
    remove.mutate(draft.id, {
      onSuccess: () => navigate('/borradores', { replace: true }),
      onError: () => {
        deleted.current = false;
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
          <span aria-live="polite" className="inline-flex items-center gap-1">
            {busy ? (
              <>
                <Spinner className="size-3" /> Guardando…
              </>
            ) : (
              savedOnce && (
                <>
                  <Check className="size-3.5 text-emerald-700" aria-hidden /> Cambios guardados
                </>
              )
            )}
          </span>
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
          <div className="ml-auto flex items-center gap-1">
            <button type="button" className="btn-secondary min-h-10 sm:min-h-0" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? 'Copiado' : 'Copiar'}
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
              onClick={confirmDelete}
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
