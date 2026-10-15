import { useId, useState, type FormEvent } from 'react';
import { useAddProceedings, useDocuments, useUpdateProceeding } from '../../api/hooks';
import type { ProceedingKind, ProceedingTimelineItem } from '../../api/types';
import { SelectField, TextAreaField, TextField } from '../../components/fields';
import { Alert, Dialog, Spinner } from '../../components/ui';
import { PROCEEDING_KIND_LABELS, PROCEEDING_KINDS, todayInArgentina } from '../../lib/format';

interface Fields {
  date: string;
  kind: ProceedingKind;
  title: string;
  description: string;
  /** "" = no document. */
  documentId: string;
}

/** A new actuación (editing = null) or the changes to a saved one. */
export function ProceedingDialog({
  caseId,
  editing,
  onClose,
}: {
  caseId: string;
  editing: ProceedingTimelineItem | null;
  onClose: () => void;
}) {
  const formId = useId();
  const [initial] = useState<Fields>(() => ({
    date: editing?.date ?? todayInArgentina(),
    kind: editing?.kind ?? 'ESCRITO',
    title: editing?.title ?? '',
    description: editing?.description ?? '',
    documentId: editing?.document?.id ?? '',
  }));
  const [fields, setFields] = useState<Fields>(initial);

  const add = useAddProceedings();
  const update = useUpdateProceeding();
  const { data: documents } = useDocuments();

  const saving = add.isPending || update.isPending;
  const error = add.isError ? add.error : update.isError ? update.error : null;
  const dirty = JSON.stringify(fields) !== JSON.stringify(initial);
  const library = [...(documents ?? [])]
    .filter((document) => document.status === 'READY')
    .sort((a, b) => a.title.localeCompare(b.title, 'es'));
  // A document that was deleted since must not be sent.
  const documentId = library.some((document) => document.id === fields.documentId) ? fields.documentId : '';

  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    const data = {
      date: fields.date,
      kind: fields.kind,
      title: fields.title.trim(),
      description: fields.description.trim(),
      documentId: documentId || null,
    };
    try {
      if (editing) await update.mutateAsync({ caseId, id: editing.id, ...data });
      else await add.mutateAsync({ caseId, items: [{ ...data, sourceQuote: '', source: 'MANUAL' }] });
      onClose();
    } catch {
      // the reason shows in the dialog
    }
  };

  return (
    <Dialog
      open
      title={editing ? 'Editar actuación' : 'Nueva actuación'}
      // A tap outside or Escape must not throw away what was typed.
      onClose={() => {
        if (!dirty && !saving) onClose();
      }}
      actions={
        <>
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn-primary min-h-11 sm:min-h-0" disabled={saving || (editing !== null && !dirty)}>
            {saving && <Spinner />}
            Guardar
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-4 text-ink">
        {error && <Alert tone="error">No se pudo guardar la actuación: {error.message}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Fecha" type="date" required value={fields.date} onChange={(e) => set('date', e.target.value)} />
          <SelectField label="Tipo" value={fields.kind} onChange={(e) => set('kind', e.target.value as ProceedingKind)}>
            {PROCEEDING_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {PROCEEDING_KIND_LABELS[kind]}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField
          label="Título"
          required
          maxLength={200}
          value={fields.title}
          data-autofocus
          onChange={(e) => {
            // Only spaces counts as empty (the browser alone would accept it).
            e.target.setCustomValidity(e.target.value !== '' && e.target.value.trim() === '' ? 'Completá este campo' : '');
            set('title', e.target.value);
          }}
        />
        <TextAreaField
          label="Descripción (opcional)"
          rows={3}
          maxLength={4000}
          value={fields.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <SelectField label="Documento de la biblioteca (opcional)" value={documentId} onChange={(e) => set('documentId', e.target.value)}>
          <option value="">Ninguno</option>
          {library.map((document) => (
            <option key={document.id} value={document.id}>
              {document.title}
            </option>
          ))}
        </SelectField>
      </form>
    </Dialog>
  );
}
