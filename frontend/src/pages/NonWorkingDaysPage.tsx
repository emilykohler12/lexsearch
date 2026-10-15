import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useAddNonWorkingDay, useCalendar, useDeleteNonWorkingDay } from '../api/hooks';
import type { NonWorkingDay } from '../api/types';
import { TextField } from '../components/fields';
import { Alert, Dialog, PageHeader, Spinner } from '../components/ui';
import { formatDay, todayInArgentina } from '../lib/format';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const range = (day: NonWorkingDay) =>
  day.startDate === day.endDate ? formatDay(day.startDate) : `${formatDay(day.startDate)} al ${formatDay(day.endDate)}`;

export function NonWorkingDaysPage() {
  const [year, setYear] = useState(() => Number(todayInArgentina().slice(0, 4)));
  const { data, isPending, isError, error } = useCalendar(year);
  const remove = useDeleteNonWorkingDay();
  const [toDelete, setToDelete] = useState<NonWorkingDay | null>(null);

  return (
    <>
      <Link to="/plazos" className="inline-flex min-h-10 items-center text-sm text-muted hover:text-ink">
        ← Volver a plazos
      </Link>
      <PageHeader
        title="Días inhábiles"
        description="Los feriados nacionales ya están incluidos. Cargá acá la feria judicial y los días que cambian según tu juzgado: al agregarlos o quitarlos, los plazos pendientes se recalculan."
      />

      <div className="space-y-6">
        <div className="flex items-center gap-2" role="group" aria-label="Año">
          <button
            type="button"
            className="btn-icon"
            onClick={() => setYear((y) => Math.max(MIN_YEAR, y - 1))}
            disabled={year <= MIN_YEAR}
            title="Año anterior"
          >
            <ChevronLeft className="size-4" aria-hidden />
            <span className="sr-only">Año anterior</span>
          </button>
          <span className="min-w-16 text-center font-serif text-xl" aria-live="polite">
            {year}
          </span>
          <button
            type="button"
            className="btn-icon"
            onClick={() => setYear((y) => Math.min(MAX_YEAR, y + 1))}
            disabled={year >= MAX_YEAR}
            title="Año siguiente"
          >
            <ChevronRight className="size-4" aria-hidden />
            <span className="sr-only">Año siguiente</span>
          </button>
        </div>

        {isPending && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Cargando…
          </p>
        )}
        {isError && <Alert tone="error">{error.message}</Alert>}
        {remove.isError && <Alert tone="error">{remove.error.message}</Alert>}

        {data && (
          <>
            <section className="card p-4 sm:p-5" aria-labelledby="custom-title">
              <h2 id="custom-title" className="text-lg">
                Tus días inhábiles
              </h2>
              {data.customDays.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Todavía no cargaste ninguno para {year}.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line">
                  {data.customDays.map((day) => (
                    <li key={day.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium break-words">{day.label}</p>
                        <p className="text-xs text-muted">{range(day)}</p>
                      </div>
                      <button
                        type="button"
                        className="btn-icon shrink-0 hover:text-red-700"
                        onClick={() => setToDelete(day)}
                        title="Quitar"
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="sr-only">Quitar «{day.label}»</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <AddForm onAdded={(startDate) => setYear(Number(startDate.slice(0, 4)))} />
            </section>

            <section className="card p-4 sm:p-5" aria-labelledby="holidays-title">
              <h2 id="holidays-title" className="text-lg">
                Feriados nacionales {data.year}
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {data.holidays.map((holiday) => (
                  <li key={holiday.date} className="flex flex-wrap gap-x-4 gap-y-0.5 py-2 text-sm">
                    <span className="w-32 shrink-0 font-medium tabular-nums">{formatDay(holiday.date)}</span>
                    <span className="min-w-0 flex-1 break-words text-muted">{holiday.name}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>

      <Dialog
        open={toDelete !== null}
        title="¿Quitar este día inhábil?"
        onClose={() => setToDelete(null)}
        actions={
          <>
            <button type="button" className="btn-secondary min-h-11 sm:min-h-0" data-autofocus onClick={() => setToDelete(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-danger min-h-11 sm:min-h-0"
              onClick={() => toDelete && remove.mutate(toDelete.id, { onSettled: () => setToDelete(null) })}
              disabled={remove.isPending}
            >
              {remove.isPending && <Spinner />}
              Quitar
            </button>
          </>
        }
      >
        «{toDelete?.label}» deja de ser inhábil y los plazos pendientes se recalculan.
      </Dialog>
    </>
  );
}

function AddForm({ onAdded }: { onAdded: (startDate: string) => void }) {
  const add = useAddNonWorkingDay();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [label, setLabel] = useState('');
  const titleId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate(
      { startDate, label: label.trim(), ...(endDate && { endDate }) },
      {
        onSuccess: () => {
          onAdded(startDate);
          setStartDate('');
          setEndDate('');
          setLabel('');
        },
      },
    );
  };

  return (
    <form onSubmit={submit} className="mt-4 border-t border-line pt-4" aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-3 text-sm font-semibold">
        Agregar un día o un período
      </h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[10rem_10rem_1fr_auto] lg:items-end">
        <TextField label="Desde" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        <TextField
          label="Hasta (opcional)"
          type="date"
          min={startDate || undefined}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <TextField
          label="Motivo"
          className="sm:col-span-2 lg:col-span-1"
          required
          maxLength={120}
          placeholder="Ej.: Feria judicial de invierno"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button type="submit" className="btn-primary min-h-11 sm:col-span-2 sm:min-h-0 lg:col-span-1" disabled={add.isPending}>
          {add.isPending ? <Spinner /> : <Plus className="size-4" aria-hidden />}
          Agregar
        </button>
      </div>
      {add.isError && (
        <div className="mt-3">
          <Alert tone="error">{add.error.message}</Alert>
        </div>
      )}
    </form>
  );
}
