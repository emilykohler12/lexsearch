import { CircleCheck, Clock, TriangleAlert } from 'lucide-react';
import type { DeadlineState } from '../../api/types';
import { whenText } from '../../lib/format';

const STYLES: Record<DeadlineState, string> = {
  OVERDUE: 'bg-red-50 text-red-800 ring-red-200',
  TODAY: 'bg-red-50 text-red-800 ring-red-200',
  SOON: 'bg-amber-50 text-amber-800 ring-amber-200',
  ONGOING: 'bg-slate-100 text-slate-700 ring-slate-200',
  DONE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
};

/** How close a deadline is, in words and colors: red when it is today or past, amber when it is near. */
export function DeadlineWhen({ state, daysLeft }: { state: DeadlineState; daysLeft: number }) {
  const Icon = state === 'DONE' ? CircleCheck : state === 'OVERDUE' || state === 'TODAY' ? TriangleAlert : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STYLES[state]}`}>
      <Icon className="size-3" aria-hidden />
      {state === 'DONE' ? 'Cumplido' : whenText(daysLeft)}
    </span>
  );
}
