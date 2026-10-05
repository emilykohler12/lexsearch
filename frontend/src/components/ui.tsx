import { CircleCheck, CircleX, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import type { DocumentCategory, DocumentStatus } from '../api/types';
import { CATEGORY_LABELS, STATUS_LABELS } from '../lib/format';

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 md:mb-8">
      <div>
        <h1 className="text-2xl text-ink sm:text-3xl">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions}
    </header>
  );
}

const ALERT_STYLES = {
  info: { box: 'border-sky-200 bg-sky-50 text-sky-900', icon: Info },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: TriangleAlert },
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: CircleX },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: CircleCheck },
};

export function Alert({
  tone,
  children,
  onClose,
}: {
  tone: keyof typeof ALERT_STYLES;
  children: ReactNode;
  onClose?: () => void;
}) {
  const { box, icon: Icon } = ALERT_STYLES[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${box}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Cerrar aviso">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

/**
 * A question with LexSearch's look, instead of the browser's confirm() box. Escape or a click
 * outside the box calls onClose; the button marked data-autofocus gets the focus when it opens.
 */
export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // Escape: the page closes it through `open`
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-line bg-white p-0 text-ink shadow-xl backdrop:bg-navy-950/50"
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="text-lg leading-snug">
          {title}
        </h2>
        {children && <div className="mt-2 text-sm text-muted">{children}</div>}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div>
      </div>
    </dialog>
  );
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <LoaderCircle className={`animate-spin ${className}`} aria-hidden />;
}

const STATUS_STYLES: Record<DocumentStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-800 ring-amber-200',
  PROCESSING: 'bg-sky-50 text-sky-800 ring-sky-200',
  READY: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  FAILED: 'bg-red-50 text-red-800 ring-red-200',
};

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const busy = status === 'PENDING' || status === 'PROCESSING';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[status]}`}>
      {busy && <Spinner className="size-3" />}
      {STATUS_LABELS[status]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: DocumentCategory }) {
  return (
    <span className="inline-flex rounded-md bg-brass-50 px-2 py-0.5 text-xs font-medium text-brass-700 ring-1 ring-brass-100">
      {CATEGORY_LABELS[category]}
    </span>
  );
}
