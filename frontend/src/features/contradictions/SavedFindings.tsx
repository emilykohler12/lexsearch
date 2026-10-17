import { Check, Copy, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { Contradiction } from '../../api/types';
import { Spinner } from '../../components/ui';
import { ConfidenceBadge, KindBadge, StatementList } from './finding-parts';
import { findingsToText } from './finding-text';

/** The contradictions the lawyer confirmed, with her notes. The notes are edited here and saved from the page. */
export function SavedFindings({
  caseTitle,
  findings,
  notes,
  dirtyCount,
  saving,
  onNoteChange,
  onSaveNotes,
  onDelete,
}: {
  caseTitle: string;
  findings: Contradiction[];
  /** What is typed in each note (by id); a finding that isn't there shows its saved note. */
  notes: Record<string, string>;
  dirtyCount: number;
  saving: boolean;
  onNoteChange: (id: string, value: string) => void;
  onSaveNotes: () => void;
  onDelete: (finding: Contradiction) => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(findingsToText(caseTitle, findings.map((finding) => ({ ...finding, note: notes[finding.id] ?? finding.note }))));
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // The browser can refuse access to the clipboard (a blocked permission): nothing to do but not pretend it worked.
      setCopied(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="saved-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="saved-title" className="text-lg">
          Contradicciones guardadas <span className="font-sans text-sm text-muted">({findings.length})</span>
        </h2>
        <div className="flex flex-wrap gap-2">
          {dirtyCount > 0 && (
            <button type="button" className="btn-primary min-h-11 sm:min-h-0" onClick={onSaveNotes} disabled={saving}>
              {saving && <Spinner />}
              {saving ? 'Guardando…' : 'Guardar notas'}
            </button>
          )}
          <button type="button" className="btn-secondary min-h-11 sm:min-h-0" onClick={() => void copy()}>
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
            {copied ? 'Copiado' : 'Copiar resumen'}
          </button>
        </div>
      </div>

      <ul className="space-y-3">
        {findings.map((finding) => (
          <li key={finding.id} className="card p-3 sm:p-4">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <KindBadge kind={finding.kind} />
                  <ConfidenceBadge confidence={finding.confidence} />
                </div>
                <p className="mt-2 font-medium break-words">{finding.title}</p>
                {finding.explanation && <p className="mt-1 text-sm break-words text-muted">{finding.explanation}</p>}
              </div>
              <button type="button" className="btn-icon -mt-1 -mr-1 shrink-0 hover:text-red-700" onClick={() => onDelete(finding)} title="Eliminar">
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only">Eliminar «{finding.title}»</span>
              </button>
            </div>

            <div className="mt-3">
              <StatementList statements={finding.statements} />
            </div>

            <div className="mt-3">
              <label htmlFor={`note-${finding.id}`} className="label">
                Tu nota
              </label>
              <textarea
                id={`note-${finding.id}`}
                className="input field-sizing-content min-h-16 resize-y leading-relaxed"
                rows={2}
                maxLength={4_000}
                value={notes[finding.id] ?? finding.note}
                onChange={(e) => onNoteChange(finding.id, e.target.value)}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
