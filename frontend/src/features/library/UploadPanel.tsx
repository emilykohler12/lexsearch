import { CloudUpload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useCreateTextDocument, useUploadDocuments } from '../../api/hooks';
import type { DocumentCategory, UploadResult } from '../../api/types';
import { Alert, Spinner } from '../../components/ui';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/format';

// Photos and scans are read with OCR.
const ACCEPT = '.pdf,.docx,.doc,.pptx,.svg,.txt,.md,.jpg,.jpeg,.png,.webp,.tif,.tiff';

type Mode = 'FILES' | 'TEXT';

/** Adds documents to the library, uploaded or typed in; with `caseId`, to an expediente (they are its pruebas, escritos...). */
export function UploadPanel({
  caseId,
  defaultCategory = 'LEGISLACION',
}: {
  caseId?: string;
  defaultCategory?: DocumentCategory;
}) {
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>('FILES');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const categoryId = useId();
  const inputId = useId();
  const titleId = useId();
  const textId = useId();
  const upload = useUploadDocuments();
  const createText = useCreateTextDocument();

  const send = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setResults(null);
    upload.mutate({ files, category, ...(caseId && { caseId }) }, { onSuccess: setResults });
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files);
  };

  const saveText = () => {
    setResults(null);
    createText.mutate(
      { title: title.trim(), text: text.trim(), category, ...(caseId && { caseId }) },
      {
        onSuccess: (result) => {
          setResults([result]);
          if (result.status === 'created') {
            setTitle('');
            setText('');
          }
        },
      },
    );
  };

  const modes: Array<[Mode, string]> = [
    ['FILES', 'Subir archivos'],
    ['TEXT', 'Escribir texto'],
  ];

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="upload-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="upload-title" className="text-lg">
          Agregar documentos
        </h2>
        <div role="tablist" aria-label="Cómo agregar" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-white p-1 ring-1 ring-line">
          {modes.map(([name, label]) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={mode === name}
              onClick={() => setMode(name)}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-md px-3 text-sm transition-colors sm:min-h-9 ${
                mode === name ? 'bg-paper font-medium text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'TEXT' && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
            <div>
              <label htmlFor={`${categoryId}-text`} className="label">
                Tipo de documento
              </label>
              <select id={`${categoryId}-text`} className="input" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={titleId} className="label">
                Título
              </label>
              <input id={titleId} className="input" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor={textId} className="label">
              Texto
            </label>
            <textarea id={textId} className="input min-h-48 w-full" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <button type="button" className="btn-primary min-h-11 sm:min-h-0" disabled={createText.isPending || !title.trim() || !text.trim()} onClick={saveText}>
            {createText.isPending && <Spinner />}
            Guardar en la biblioteca
          </button>
          {createText.isError && (
            <Alert tone="error" onClose={() => createText.reset()}>
              {createText.error.message}
            </Alert>
          )}
        </div>
      )}

      <div className={`mt-4 grid gap-4 md:grid-cols-[16rem_1fr] ${mode === 'TEXT' ? 'hidden' : ''}`}>
        <div>
          <label htmlFor={categoryId} className="label">
            Tipo de documento
          </label>
          <select
            id={categoryId}
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

        {/* The whole zone is the file picker's label: a tap (phone) or click opens it, and it also accepts drops. */}
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors focus-within:border-brass-500 hover:border-brass-500 ${
            dragging ? 'border-brass-500 bg-brass-50' : 'border-line bg-paper/60'
          }`}
        >
          {upload.isPending ? (
            <>
              <Spinner className="size-6 text-brass-600" />
              <span className="text-sm text-muted">Subiendo…</span>
            </>
          ) : (
            <>
              <CloudUpload className="size-7 text-brass-600" aria-hidden />
              <span className="text-sm">
                <span className="hidden sm:inline">Arrastrá los archivos acá o </span>
                <span className="font-medium text-brass-700 underline">
                  <span className="sm:hidden">Tocá para elegir archivos</span>
                  <span className="hidden sm:inline">elegilos desde tu computadora</span>
                </span>
              </span>
              <span className="text-xs text-muted">Hasta 20 archivos por vez · máx. 50 MB cada uno</span>
            </>
          )}
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            disabled={upload.isPending}
            onChange={(e) => send(e.target.files)}
          />
        </label>
      </div>

      {upload.isError && (
        <div className="mt-4">
          <Alert tone="error" onClose={() => upload.reset()}>
            {upload.error.message}
          </Alert>
        </div>
      )}
      {results && <UploadResults results={results} onClose={() => setResults(null)} />}
    </section>
  );
}

function UploadResults({ results, onClose }: { results: UploadResult[]; onClose: () => void }) {
  const created = results.filter((r) => r.status === 'created').length;
  const tone = results.some((r) => r.status === 'rejected') ? 'warning' : 'success';
  return (
    <div className="mt-4">
      <Alert tone={tone} onClose={onClose}>
        <p className="font-medium">
          {created > 0
            ? `${created} ${created === 1 ? 'documento subido' : 'documentos subidos'}: se están procesando.`
            : 'No se agregaron documentos nuevos.'}
        </p>
        <ul className="mt-1 space-y-0.5">
          {results.map((r) => (
            <li key={r.originalName}>
              <span className="font-medium">{r.originalName}</span>
              {' — '}
              {r.status === 'created' && 'subido'}
              {r.status === 'duplicate' && `ya estaba en tu biblioteca como «${r.document.title}»`}
              {r.status === 'rejected' && r.message.replace(`"${r.originalName}": `, '')}
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
