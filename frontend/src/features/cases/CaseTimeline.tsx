import { CalendarClock, CircleDot, FileText, FlaskConical, Gavel, Paperclip, Pencil, Send, Trash2, Users, type LucideIcon } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../api/client';
import type { DeadlineState, DeadlineTimelineItem, ProceedingKind, ProceedingTimelineItem, TimelineItem } from '../../api/types';
import { formatDay, gapText, PROCEEDING_KIND_LABELS, termText } from '../../lib/format';
import { DeadlineWhen } from '../deadlines/DeadlineWhen';
import { buildGroups, type TimelineRow } from './timeline-rows';

const KIND_STYLE: Record<ProceedingKind, { icon: LucideIcon; dot: string; badge: string }> = {
  ESCRITO: { icon: FileText, dot: 'bg-brass-500', badge: 'bg-brass-50 text-brass-700 ring-brass-100' },
  RESOLUCION: { icon: Gavel, dot: 'bg-navy-800', badge: 'bg-navy-900/5 text-navy-800 ring-navy-900/10' },
  NOTIFICACION: { icon: Send, dot: 'bg-sky-600', badge: 'bg-sky-50 text-sky-800 ring-sky-200' },
  AUDIENCIA: { icon: Users, dot: 'bg-violet-600', badge: 'bg-violet-50 text-violet-800 ring-violet-200' },
  PRUEBA: { icon: FlaskConical, dot: 'bg-emerald-600', badge: 'bg-emerald-50 text-emerald-800 ring-emerald-200' },
  OTRO: { icon: CircleDot, dot: 'bg-slate-500', badge: 'bg-slate-100 text-slate-700 ring-slate-200' },
};

const DEADLINE_COLOR: Record<DeadlineState, { dot: string; stripe: string }> = {
  OVERDUE: { dot: 'bg-red-600', stripe: 'border-l-red-500' },
  TODAY: { dot: 'bg-red-600', stripe: 'border-l-red-500' },
  SOON: { dot: 'bg-amber-500', stripe: 'border-l-amber-400' },
  ONGOING: { dot: 'bg-slate-500', stripe: 'border-l-slate-300' },
  DONE: { dot: 'bg-emerald-600', stripe: 'border-l-emerald-400' },
};

/**
 * The expediente as a vertical line: each actuación and each deadline's due date in their place,
 * grouped by month, with a marker for today and a note when a long time passed without movement.
 */
export function CaseTimeline({
  items,
  today,
  onEdit,
  onDelete,
}: {
  items: TimelineItem[];
  today: string;
  onEdit: (item: ProceedingTimelineItem) => void;
  onDelete: (item: ProceedingTimelineItem) => void;
}) {
  const groups = useMemo(() => buildGroups(items, today), [items, today]);

  return (
    <div className="relative">
      <span className="absolute top-2 bottom-2 left-[11px] w-0.5 bg-stone-300" aria-hidden />
      <ol>
        {groups.map((group) => (
          <li key={group.key} className="mt-6 first:mt-0">
            <h3 className="mb-3 pl-9 font-sans text-xs font-semibold tracking-wide text-muted uppercase">{group.label}</h3>
            <ol className="space-y-3">
              {group.rows.map((row) => (
                <TimelineLine key={row.kind === 'today' ? 'today' : `${row.item.type}-${row.item.id}`} row={row} today={today} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TimelineLine({
  row,
  today,
  onEdit,
  onDelete,
}: {
  row: TimelineRow;
  today: string;
  onEdit: (item: ProceedingTimelineItem) => void;
  onDelete: (item: ProceedingTimelineItem) => void;
}) {
  if (row.kind === 'today') {
    return (
      <li id="hoy" className="relative scroll-mt-40 pl-9">
        <span className="absolute top-0.5 left-0 grid size-6 place-items-center rounded-full bg-brass-500 ring-4 ring-paper" aria-hidden>
          <span className="size-2 rounded-full bg-white" />
        </span>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-brass-500 px-3 py-1 text-xs font-semibold text-white">Hoy · {formatDay(row.date)}</span>
          <span className="h-px flex-1 bg-brass-500/40" aria-hidden />
        </div>
      </li>
    );
  }

  const { item, gapDays } = row;
  return (
    <li className="relative pl-9">
      {gapDays !== null && (
        <p className="mb-2 text-xs text-muted italic">{gapText(gapDays)} sin movimiento</p>
      )}
      {item.type === 'PROCEEDING' ? (
        <ProceedingCard item={item} future={item.date > today} onEdit={onEdit} onDelete={onDelete} />
      ) : (
        <DeadlineCard item={item} />
      )}
    </li>
  );
}

function Dot({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`absolute top-3 left-0 grid size-6 place-items-center rounded-full text-white ring-4 ring-paper ${className}`} aria-hidden>
      {children}
    </span>
  );
}

function ProceedingCard({
  item,
  future,
  onEdit,
  onDelete,
}: {
  item: ProceedingTimelineItem;
  future: boolean;
  onEdit: (item: ProceedingTimelineItem) => void;
  onDelete: (item: ProceedingTimelineItem) => void;
}) {
  const style = KIND_STYLE[item.kind];
  const Icon = style.icon;

  return (
    <>
      <Dot className={style.dot}>
        <Icon className="size-3.5" />
      </Dot>
      <div className="card p-3.5 sm:p-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="font-medium text-ink/80">{formatDay(item.date)}</span>
              <span className={`inline-flex rounded-md px-2 py-0.5 font-medium ring-1 ${style.badge}`}>{PROCEEDING_KIND_LABELS[item.kind]}</span>
              {item.source === 'AI' && (
                <span className="inline-flex rounded-md bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200" title="Leída por la IA">
                  IA
                </span>
              )}
              {future && <span className="font-medium text-brass-700">Próxima</span>}
            </p>
            <p className="mt-1.5 font-medium break-words">{item.title}</p>
            {item.description && <p className="mt-1 text-sm break-words text-muted">{item.description}</p>}
            {item.document && (
              <a
                href={api.documentFileUrl(item.document.id)}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex max-w-full items-center gap-1.5 text-xs font-medium text-brass-700 hover:underline"
              >
                <Paperclip className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{item.document.title}</span>
              </a>
            )}
            {item.sourceQuote && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-muted hover:text-ink">Frase del texto</summary>
                <blockquote className="mt-1 border-l-2 border-brass-500 pl-2 break-words text-muted">{item.sourceQuote}</blockquote>
              </details>
            )}
          </div>
          <div className="-mt-1 -mr-1 flex shrink-0 items-center">
            <button type="button" className="btn-icon" onClick={() => onEdit(item)} title="Editar">
              <Pencil className="size-4" aria-hidden />
              <span className="sr-only">Editar «{item.title}»</span>
            </button>
            <button type="button" className="btn-icon hover:text-red-700" onClick={() => onDelete(item)} title="Eliminar">
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Eliminar «{item.title}»</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function DeadlineCard({ item }: { item: DeadlineTimelineItem }) {
  const color = DEADLINE_COLOR[item.state];

  return (
    <>
      <Dot className={color.dot}>
        <CalendarClock className="size-3.5" />
      </Dot>
      <Link to={`/plazos/${item.id}`} className={`card block border-l-4 p-3.5 hover:bg-paper/70 sm:p-4 ${color.stripe}`}>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted">
          <span className="font-medium text-ink/80">{formatDay(item.date)}</span>
          <DeadlineWhen state={item.state} daysLeft={item.daysLeft} />
        </p>
        <p className="mt-1.5 font-medium break-words">
          <span className="text-muted">Vence: </span>
          {item.title}
        </p>
        <p className="mt-1 text-xs text-muted">
          {termText(item.days, item.dayType)} desde la notificación del {formatDay(item.notificationDate)}
        </p>
      </Link>
    </>
  );
}
