import type { NonWorkingDay } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../lib/errors.js';
import { createCalendar, type Calendar } from './business-days.js';
import type { NonWorkingDayInput } from './calendar.schemas.js';
import { toIsoDate } from './dates.js';
import { nationalHolidays, type Holiday } from './holidays.js';
import type { NonWorkingDayData, NonWorkingDaysRepository } from './non-working-days.repository.js';

interface CalendarServiceDeps {
  repository: NonWorkingDaysRepository;
  /** Runs after the lawyer's days change: deadlines already saved may now end on another day. */
  afterChange: () => Promise<unknown>;
}

const normalize = (input: NonWorkingDayInput): NonWorkingDayData => ({
  startDate: input.startDate,
  endDate: input.endDate ?? input.startDate,
  label: input.label,
});

export class CalendarService {
  constructor(private readonly deps: CalendarServiceDeps) {}

  /** The calendar used to count terms: national holidays plus the lawyer's own days. */
  async load(): Promise<Calendar> {
    const days = await this.deps.repository.list();
    return createCalendar(
      days.map((day) => ({ startDate: toIsoDate(day.startDate), endDate: toIsoDate(day.endDate), label: day.label })),
    );
  }

  /** What counts as a non-working day in a year: the holidays (calculated) and the lawyer's days. */
  async overview(year: number): Promise<{ year: number; holidays: Holiday[]; customDays: NonWorkingDay[] }> {
    const first = `${year}-01-01`;
    const last = `${year}-12-31`;
    const days = await this.deps.repository.list();
    return {
      year,
      holidays: nationalHolidays(year),
      customDays: days.filter((day) => toIsoDate(day.startDate) <= last && toIsoDate(day.endDate) >= first),
    };
  }

  async create(input: NonWorkingDayInput): Promise<NonWorkingDay> {
    const day = await this.deps.repository.create(normalize(input));
    await this.deps.afterChange();
    return day;
  }

  async update(id: string, input: NonWorkingDayInput): Promise<NonWorkingDay> {
    await this.get(id);
    const day = await this.deps.repository.update(id, normalize(input));
    await this.deps.afterChange();
    return day;
  }

  async delete(id: string): Promise<void> {
    await this.get(id);
    await this.deps.repository.delete(id);
    await this.deps.afterChange();
  }

  private async get(id: string): Promise<NonWorkingDay> {
    const day = await this.deps.repository.findById(id);
    if (!day) throw new NotFoundError('El día inhábil no existe o fue eliminado');
    return day;
  }
}
