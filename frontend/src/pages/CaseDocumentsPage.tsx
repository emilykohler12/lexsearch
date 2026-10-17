import { FileText } from 'lucide-react';
import { useState } from 'react';
import { useDocuments, useUpdateDocument } from '../api/hooks';
import type { LibraryDocument } from '../api/types';
import { Alert, Spinner } from '../components/ui';
import { useCaseContext } from '../features/cases/case-context';
import { DocumentsTable } from '../features/library/DocumentsTable';
import { UploadPanel } from '../features/library/UploadPanel';
import { CATEGORY_LABELS } from '../lib/format';

/** The «Documentos» section of an expediente: its pruebas and escritos, to read and to compare. */
export function CaseDocumentsPage() {
  const { found } = useCaseContext();
  const { data: documents, isPending, isError, error } = useDocuments({ caseId: found.id });
  const { data: library } = useDocuments();

  return (
    <div className="space-y-6">
      <UploadPanel caseId={found.id} defaultCategory="PRUEBA" />
      <LinkFromLibrary caseId={found.id} library={library} />

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando documentos…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {documents && documents.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
          <FileText className="size-8 text-brass-500" aria-hidden />
          <p className="font-serif text-lg">Este expediente todavía no tiene documentos</p>
        </div>
      )}
      {documents && documents.length > 0 && <DocumentsTable documents={documents} heading="Documentos del expediente" caseId={found.id} />}
    </div>
  );
}

/** Documents that were in the library before the expediente: any one that doesn't belong to another expediente can be linked. */
function LinkFromLibrary({ caseId, library }: { caseId: string; library: LibraryDocument[] | undefined }) {
  const [chosen, setChosen] = useState('');
  const link = useUpdateDocument();
  const available = (library ?? []).filter((document) => !document.caseId).sort((a, b) => a.title.localeCompare(b.title, 'es'));
  if (available.length === 0) return null;

  return (
    <section className="card p-4 sm:p-5" aria-labelledby="link-title">
      <h2 id="link-title" className="text-lg">
        Vincular un documento de la biblioteca
      </h2>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row">
        <select
          aria-labelledby="link-title"
          className="input sm:max-w-lg"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">Elegí un documento…</option>
          {available.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title} · {CATEGORY_LABELS[document.category]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn-secondary min-h-11 sm:min-h-0"
          disabled={!chosen || link.isPending}
          onClick={() => link.mutate({ id: chosen, caseId }, { onSuccess: () => setChosen('') })}
        >
          {link.isPending && <Spinner />}
          Vincular
        </button>
      </div>
      {link.isError && (
        <div className="mt-3">
          <Alert tone="error">{link.error.message}</Alert>
        </div>
      )}
    </section>
  );
}
