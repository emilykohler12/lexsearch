import { useRef, useState } from 'react';
import { useContradictions, useDeleteContradiction, useDocuments, useUpdateContradictionNote } from '../api/hooks';
import type { Contradiction } from '../api/types';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';
import { Alert, Dialog, Spinner } from '../components/ui';
import { useCaseContext } from '../features/cases/case-context';
import { Comparer } from '../features/contradictions/Comparer';
import { SavedFindings } from '../features/contradictions/SavedFindings';
import { useSaveShortcut } from '../hooks/useSaveShortcut';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

/** The «Contradicciones» section of an expediente: compare its documents and keep the findings. */
export function CaseContradictionsPage() {
  const { found } = useCaseContext();
  const { data: documents } = useDocuments({ caseId: found.id });
  const { data: saved, isPending, isError, error } = useContradictions(found.id);
  const updateNote = useUpdateContradictionNote();
  const remove = useDeleteContradiction();

  // What is typed in the notes, by id, until it is saved. Nothing is saved until the lawyer says so.
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Contradiction | null>(null);
  // Set when the page is left on purpose; the notes never leave it that way, but the hook asks for it.
  const leaving = useRef(false);

  const dirty = (saved ?? []).filter((finding) => notes[finding.id] !== undefined && notes[finding.id] !== finding.note);

  /** Saves the notes that changed; false when one could not be saved (the reason shows on the page). */
  const saveNotes = async (): Promise<boolean> => {
    try {
      for (const finding of dirty) {
        await updateNote.mutateAsync({ caseId: found.id, id: finding.id, note: notes[finding.id]!.trim() });
        setNotes((current) => {
          const { [finding.id]: _saved, ...rest } = current;
          return rest;
        });
      }
      return true;
    } catch {
      return false;
    }
  };

  useSaveShortcut(() => {
    if (dirty.length > 0 && !updateNote.isPending) void saveNotes();
  });
  const { blocker, saveAndLeave } = useUnsavedChanges({
    dirty: dirty.length > 0,
    saving: updateNote.isPending,
    save: saveNotes,
    leaving,
  });

  const confirmDelete = () => {
    if (!deleting) return;
    remove.mutate(
      { caseId: found.id, id: deleting.id },
      {
        onSuccess: () => {
          setNotes((current) => {
            const { [deleting.id]: _removed, ...rest } = current;
            return rest;
          });
          setDeleting(null);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <Comparer found={found} documents={documents ?? []} onSaved={setNotice} />

      {notice && (
        <Alert tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {updateNote.isError && <Alert tone="error">No se pudo guardar la nota: {updateNote.error.message}</Alert>}
      {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

      {isPending && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Cargando…
        </p>
      )}
      {isError && <Alert tone="error">{error.message}</Alert>}
      {saved && saved.length > 0 && (
        <SavedFindings
          caseTitle={found.title}
          findings={saved}
          notes={notes}
          dirtyCount={dirty.length}
          saving={updateNote.isPending}
          onNoteChange={(id, value) => setNotes((current) => ({ ...current, [id]: value }))}
          onSaveNotes={() => void saveNotes()}
          onDelete={setDeleting}
        />
      )}

      <UnsavedChangesDialog blocker={blocker} saving={updateNote.isPending} onSaveAndLeave={() => void saveAndLeave()} />

      <Dialog
        open={deleting !== null}
        title="¿Eliminar esta contradicción?"
        onClose={() => setDeleting(null)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => setDeleting(null)}>
              Cancelar
            </button>
            <button type="button" className="btn-danger min-h-11 sm:min-h-0" onClick={confirmDelete} disabled={remove.isPending}>
              {remove.isPending && <Spinner />}
              Eliminar
            </button>
          </>
        }
      >
        {deleting && (
          <>
            «{deleting.title}» se elimina definitivamente{(notes[deleting.id] ?? deleting.note).trim() ? ', con tu nota' : ''}.
          </>
        )}
      </Dialog>
    </div>
  );
}
