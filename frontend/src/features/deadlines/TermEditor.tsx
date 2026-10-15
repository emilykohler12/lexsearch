import { Check, Trash2, TriangleAlert } from 'lucide-react';
import { useDueDate } from '../../api/hooks';
import type { DayType } from '../../api/types';
import { SelectField, TextField } from '../../components/fields';
import { Alert, Spinner } from '../../components/ui';
import { DAY_TYPE_LABELS, DAY_TYPES, formatDay, plural } from '../../lib/format';
import { DeadlineWhen } from './DeadlineWhen';
import { stateForDaysLeft, termForCalculation, type TermRow } from './deadline-form';

/** The due date a term would have, with the days that did not count so it can be checked against the court's. */
function DueDatePreview({ notificationDate, row }: { notificationDate: string; row: TermRow }) {
  const term = termForCalculation(notificationDate, row);
  const { data, isError, error, isFetching } = useDueDate(term);

  if (!term) {
    return <p className="text-sm text-muted">Indicá la fecha de notificación y los días para ver el vencimiento.</p>;
  }
  if (isError) return <Alert tone="error">{error.message}</Alert>;
  if (!data) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Calculando el vencimiento…
      </p>
    );
  }

  return (
    <div className={isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-live="polite">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="font-medium">Vence el {formatDay(data.dueDate)}</span>
        <DeadlineWhen state={stateForDaysLeft(data.daysLeft)} daysLeft={data.daysLeft} />
      </p>
      {data.skipped.length > 0 && (
        <details className="mt-2 text-xs text-muted">
          <summary className="min-h-8 cursor-pointer py-1.5 font-medium text-brass-700 hover:underline">
            Cómo se contó: no se contaron {plural(data.skipped.length, 'día', 'días')}
          </summary>
          <ul className="mt-1 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {data.skipped.map((day) => (
              <li key={day.date}>
                {formatDay(day.date)} · {day.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** One term of the deadline: what to do, how many days, and the due date that results. */
export function TermEditor({
  row,
  notificationDate,
  canRemove,
  onChange,
  onRemove,
}: {
  row: TermRow;
  notificationDate: string;
  canRemove: boolean;
  /** Any edit clears the highlight of what the AI filled in. */
  onChange: (changes: Partial<TermRow>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-line p-4">
      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-4 md:grid-cols-[1fr_7rem_11rem]">
          <TextField
            label="Qué hay que hacer"
            value={row.title}
            maxLength={200}
            required
            suggested={row.suggested}
            onChange={(e) => onChange({ title: e.target.value, suggested: false })}
          />
          <TextField
            label="Días"
            type="number"
            inputMode="numeric"
            min={1}
            max={365}
            step={1}
            required
            value={row.days}
            suggested={row.suggested && !row.daysMissing}
            onChange={(e) => onChange({ days: e.target.value, suggested: false, daysMissing: false })}
          />
          <SelectField
            label="Tipo de días"
            value={row.dayType}
            suggested={row.suggested}
            onChange={(e) => onChange({ dayType: e.target.value as DayType, suggested: false })}
          >
            {DAY_TYPES.map((type) => (
              <option key={type} value={type}>
                {DAY_TYPE_LABELS[type]}
              </option>
            ))}
          </SelectField>
        </div>
        {canRemove && (
          <button type="button" className="btn-icon mt-5 shrink-0 hover:text-red-700" onClick={onRemove} title="Quitar este plazo">
            <Trash2 className="size-4" aria-hidden />
            <span className="sr-only">Quitar este plazo</span>
          </button>
        )}
      </div>

      {row.daysMissing && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          El documento no indica cuántos días: completalos según el código procesal.
        </p>
      )}

      <DueDatePreview notificationDate={notificationDate} row={row} />

      {row.quote && (
        <blockquote className="border-l-2 border-line pl-3 text-sm leading-relaxed break-words text-ink/80">
          «{row.quote}»
          <footer className="mt-1 flex items-center gap-1 text-xs text-emerald-700">
            <Check className="size-3.5" aria-hidden /> Frase del documento
          </footer>
        </blockquote>
      )}
      {row.quoteVerified === false && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          No se pudo verificar este plazo en el documento: revisalo antes de guardar.
        </p>
      )}
    </div>
  );
}
