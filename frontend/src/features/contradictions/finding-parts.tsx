import { ExternalLink, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import type { FindingConfidence, FindingKind, FindingStatement } from '../../api/types';
import { FINDING_CONFIDENCE_LABELS, FINDING_KIND_LABELS } from '../../lib/format';

const KIND_STYLES: Record<FindingKind, string> = {
  FECHA: 'bg-sky-50 text-sky-800 ring-sky-200',
  MONTO: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  DECLARACION: 'bg-violet-50 text-violet-800 ring-violet-200',
  OTRO: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const CONFIDENCE_STYLES: Record<FindingConfidence, string> = {
  DIRECTA: 'bg-red-50 text-red-800 ring-red-200',
  POSIBLE: 'bg-amber-50 text-amber-800 ring-amber-200',
};

const BADGE = 'inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1';

export function KindBadge({ kind }: { kind: FindingKind }) {
  return <span className={`${BADGE} ${KIND_STYLES[kind]}`}>{FINDING_KIND_LABELS[kind]}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: FindingConfidence }) {
  return (
    <span
      className={`${BADGE} ${CONFIDENCE_STYLES[confidence]}`}
      title={confidence === 'DIRECTA' ? 'Las afirmaciones no pueden ser verdaderas a la vez' : 'Podrían conciliarse: conviene revisarla'}
    >
      {FINDING_CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

export function NoteBadge({ tone, children }: { tone: 'info' | 'warning'; children: string }) {
  const style = tone === 'info' ? 'bg-sky-50 text-sky-800 ring-sky-200' : 'bg-amber-50 text-amber-800 ring-amber-200';
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${style}`}>{children}</span>;
}

/** A statement of a proposal, or of a saved finding (then `document` says how the document is named now, or that it is gone). */
export interface ShownStatement extends FindingStatement {
  document?: { id: string; title: string } | null;
}

/** The statements that clash, each one with the document it comes from and the document's own wording. */
export function StatementList({ statements }: { statements: ShownStatement[] }) {
  return (
    <ul className="space-y-2">
      {statements.map((statement, index) => {
        const gone = statement.document === null;
        const title = statement.document?.title ?? statement.documentTitle;
        return (
          <li key={`${statement.documentId}-${index}`} className="rounded-lg border border-line bg-paper/50 p-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-medium text-ink/80">
              <span className="break-words">{title}</span>
              {gone ? (
                <span className="font-normal text-muted">(el documento se eliminó)</span>
              ) : (
                <a
                  href={api.documentFileUrl(statement.documentId)}
                  target="_blank"
                  rel="noreferrer"
                  className="-my-3 inline-flex items-center gap-1 py-3 font-medium text-brass-700 hover:underline"
                >
                  <ExternalLink className="size-3" aria-hidden />
                  Ver original
                </a>
              )}
            </p>
            {statement.quoteVerified ? (
              <blockquote className="mt-1.5 border-l-2 border-brass-500 pl-3 text-sm break-words">“{statement.quote}”</blockquote>
            ) : (
              <p className="mt-1.5 flex items-start gap-1.5 text-xs text-amber-800">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                No se encontró esta frase en el documento: revisalo.
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
