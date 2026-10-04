import { CloudUpload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { useUploadDocuments } from '../../api/hooks';
import type { DocumentCategory, UploadResult } from '../../api/types';
import { Alert, Spinner } from '../../components/ui';
import { CATEGORIES, CATEGORY_LABELS } from '../../lib/format';

// Photos and scans are read with OCR.
const ACCEPT = '.pdf,.docx,.txt,.md,.jpg,.jpeg,.png,.webp,.tif,.tiff';

export function UploadPanel() {
  const [category, setCategory] = useState<DocumentCategory>('LEGISLACION');
  const [dragging, setDragging] = useState(false);
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryId = useId();
  const inputId = useId();
  const upload = useUploadDocuments();

  const send = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;
    setResults(null);
    upload.mutate({ files, category }, { onSuccess: setResults });
    if (inputRef.current) inputRef.current.value = '';
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    send(event.dataTransfer.files);
  };

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="upload-title">
      <h2 id="upload-title" className="text-lg">
        Subir documentos
      </h2>

      <div className="mt-4 grid gap-4 md:grid-cols-[16rem_1fr]">
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
