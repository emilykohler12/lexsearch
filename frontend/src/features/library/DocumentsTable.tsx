import { ExternalLink, FileText, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useDeleteDocument, useReprocessDocument, useUpdateDocument } from '../../api/hooks';
import type { DocumentCategory, LibraryDocument } from '../../api/types';
import { Alert, CategoryBadge, Dialog, Spinner, StatusBadge } from '../../components/ui';
import { CATEGORIES, CATEGORY_LABELS, formatBytes, formatDate, plural } from '../../lib/format';

export function DocumentsTable({ documents }: { documents: LibraryDocument[] }) {
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<DocumentCategory | ''>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<LibraryDocument | null>(null);
  const remove = useDeleteDocument();
  const reprocess = useReprocessDocument();

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return documents.filter(
      (d) =>
        (!category || d.category === category) &&
        (!needle || d.title.toLowerCase().includes(needle) || d.originalName.toLowerCase().includes(needle)),
    );
  }, [documents, filter, category]);

  const actionError = remove.error ?? reprocess.error;

  const deleteDocument = (document: LibraryDocument) =>
    remove.mutate(document.id, { onSettled: () => setToDelete(null) });

  return (
    <section className="card overflow-hidden" aria-labelledby="documents-title">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-4 sm:px-5">
        <h2 id="documents-title" className="mr-auto text-lg">
          Tus documentos <span className="font-sans text-sm text-muted">({documents.length})</span>
        </h2>
        <input
          className="input w-full sm:w-56"
          placeholder="Filtrar por nombre…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filtrar por nombre"
        />
        <select
          className="input w-full sm:w-44"
          value={category}
          onChange={(e) => setCategory(e.target.value as DocumentCategory | '')}
          aria-label="Filtrar por tipo"
        >
          <option value="">Todos los tipos</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      {actionError && (
        <div className="px-4 pt-4 sm:px-5">
          <Alert tone="error">{actionError.message}</Alert>
        </div>
      )}

      {visible.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">Ningún documento coincide con el filtro.</p>
      ) : (
        <ul className="divide-y divide-line">
          {visible.map((document) =>
            editingId === document.id ? (
              <EditRow key={document.id} document={document} onDone={() => setEditingId(null)} />
            ) : (
              <li key={document.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-4 sm:px-5">
                <FileText className="mt-0.5 hidden size-5 shrink-0 text-muted sm:block" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words sm:truncate" title={document.title}>
                    {document.title}
                  </p>
                  <p className="mt-0.5 text-xs break-all text-muted sm:truncate sm:break-normal" title={document.originalName}>
                    {document.originalName} · {formatBytes(document.sizeBytes)} · subido el {formatDate(document.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <CategoryBadge category={document.category} />
                    <StatusBadge status={document.status} />
                    {document.ocrPageCount > 0 && (
                      <span
                        className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-slate-200"
                        title="Texto reconocido con OCR (escaneo o foto): puede tener errores de lectura. Verificá las citas contra el original."
                      >
                        Leído con OCR
                      </span>
                    )}
                    {document.status === 'READY' && (
                      <span>
                        {document.pageCount !== null && `${plural(document.pageCount, 'pág.', 'págs.')} · `}
                        {plural(document.chunkCount, 'fragmento indexado', 'fragmentos indexados')}
                      </span>
                    )}
                  </div>
                  {document.status === 'FAILED' && document.errorMessage && (
                    <p className="mt-2 text-xs text-red-700">{document.errorMessage}</p>
                  )}
                </div>
                {/* On phones the actions get their own row, aligned right. */}
                <div className="flex w-full items-center justify-end gap-1 border-t border-line pt-2 sm:w-auto sm:border-0 sm:pt-0">
                  <a
                    className="btn-icon"
                    href={api.documentFileUrl(document.id)}
                    target="_blank"
                    rel="noreferrer"
                    title="Ver el archivo original"
                  >
                    <ExternalLink className="size-4" aria-hidden />
                    <span className="sr-only">Ver original de {document.title}</span>
                  </a>
                  <button type="button" className="btn-icon" onClick={() => setEditingId(document.id)} title="Editar título o tipo">
                    <Pencil className="size-4" aria-hidden />
                    <span className="sr-only">Editar {document.title}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => reprocess.mutate(document.id)}
                    disabled={document.status === 'PENDING' || document.status === 'PROCESSING'}
                    title="Volver a procesar"
                  >
                    <RefreshCw className="size-4" aria-hidden />
                    <span className="sr-only">Reprocesar {document.title}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon hover:text-red-700"
                    onClick={() => setToDelete(document)}
                    title="Eliminar"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    <span className="sr-only">Eliminar {document.title}</span>
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      <Dialog
        open={toDelete !== null}
        title="¿Eliminar este documento?"
        onClose={() => setToDelete(null)}
        actions={
          <>
            <button
              type="button"
              className="btn-secondary min-h-11 sm:min-h-0"
              data-autofocus
              onClick={() => setToDelete(null)}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger min-h-11 sm:min-h-0"
              onClick={() => toDelete && deleteDocument(toDelete)}
              disabled={remove.isPending}
            >
              {remove.isPending && <Spinner />}
              Eliminar
            </button>
          </>
        }
      >
        «{toDelete?.title}» se borra de tu biblioteca, junto con su archivo y su índice de búsqueda.
      </Dialog>
    </section>
  );
}

function EditRow({ document, onDone }: { document: LibraryDocument; onDone: () => void }) {
  const [title, setTitle] = useState(document.title);
  const [category, setCategory] = useState(document.category);
  const update = useUpdateDocument();

  return (
    <li className="bg-brass-50/50 px-4 py-4 sm:px-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          update.mutate({ id: document.id, title: title.trim(), category }, { onSuccess: onDone });
        }}
      >
        <div className="w-full sm:w-auto sm:min-w-60 sm:flex-1">
          <label className="label" htmlFor={`title-${document.id}`}>
            Título
          </label>
          <input
            id={`title-${document.id}`}
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={300}
            required
          />
        </div>
        <div className="w-full sm:w-48">
          <label className="label" htmlFor={`category-${document.id}`}>
            Tipo
          </label>
          <select
            id={`category-${document.id}`}
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as DocumentCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary flex-1 sm:flex-none" disabled={update.isPending || !title.trim()}>
          Guardar
        </button>
        <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={onDone}>
          Cancelar
        </button>
      </form>
      {update.isError && (
        <div className="mt-3">
          <Alert tone="error">{update.error.message}</Alert>
        </div>
      )}
    </li>
  );
}
