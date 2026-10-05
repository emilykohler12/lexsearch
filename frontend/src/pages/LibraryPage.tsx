import { BookOpen } from 'lucide-react';
import { useDocuments } from '../api/hooks';
import { Alert, PageHeader, Spinner } from '../components/ui';
import { DocumentsTable } from '../features/library/DocumentsTable';
import { UploadPanel } from '../features/library/UploadPanel';

export function LibraryPage() {
  const { data: documents, isPending, isError, error } = useDocuments();

  return (
    <>
      <PageHeader title="Biblioteca" />
      <div className="space-y-6">
        <UploadPanel />
        {isPending && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Cargando documentos…
          </p>
        )}
        {isError && <Alert tone="error">{error.message}</Alert>}
        {documents && documents.length === 0 && (
          <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
            <BookOpen className="size-8 text-brass-500" aria-hidden />
            <p className="font-serif text-lg">Tu biblioteca está vacía</p>
            <p className="max-w-md text-sm text-muted">
              Empezá subiendo los códigos y leyes que más usás, algunos fallos de referencia y tus modelos de contratos o
              escritos.
            </p>
          </div>
        )}
        {documents && documents.length > 0 && <DocumentsTable documents={documents} />}
      </div>
    </>
  );
}
