import { BadRequestError } from '../../lib/errors.js';
import { addDays, dayOfWeek, type IsoDate } from './dates.js';
import { nationalHolidays } from './holidays.js';

/** BUSINESS: días hábiles (they skip weekends, holidays and non-working days); CALENDAR: días corridos. */
export type DayType = 'BUSINESS' | 'CALENDAR';

/** Days the lawyer's court doesn't work beyond the national holidays: judicial recess, local holidays... */
export interface NonWorkingRange {
  startDate: IsoDate;
  endDate: IsoDate;
  label: string;
}

export interface Calendar {
  /** Why that day is not a working day, or null when it is. */
  nonWorkingReason(date: IsoDate): string | null;
}

export function createCalendar(ranges: readonly NonWorkingRange[] = []): Calendar {
  const holidaysByYear = new Map<number, Map<IsoDate, string>>();
  const holidaysOf = (year: number) => {
    let holidays = holidaysByYear.get(year);
    if (!holidays) {
      holidays = new Map(nationalHolidays(year).map((holiday) => [holiday.date, holiday.name]));
      holidaysByYear.set(year, holidays);
    }
    return holidays;
  };

  return {
    nonWorkingReason(date) {
      const weekday = dayOfWeek(date);
      if (weekday === 6) return 'Sábado';
      if (weekday === 0) return 'Domingo';
      const holiday = holidaysOf(Number(date.slice(0, 4))).get(date);
      if (holiday) return holiday;
      // ISO dates compare correctly as plain text.
      return ranges.find((range) => date >= range.startDate && date <= range.endDate)?.label ?? null;
    },
  };
}

export interface SkippedDay {
  date: IsoDate;
  reason: string;
}

export interface DueDateResult {
  /** The last day to act. */
  dueDate: IsoDate;
  /** Days that did not count, in order: the lawyer can check the calculation against the court's. */
  skipped: SkippedDay[];
}

// Ten years of days: far beyond any term, only a guard against a calendar with no working days.
const MAX_DAYS_TRAVELLED = 3650;

const CALENDAR_TOO_BUSY = 'No se pudo calcular el vencimiento: hay demasiados días inhábiles seguidos en el calendario.';

/**
 * The last day of a term. The day of the notification never counts: the term starts the day after.
 *
 * - BUSINESS: counts only working days.
 * - CALENDAR: counts every day, but if the last one is not a working day the term runs until the
 *   next one that is.
 */
export function computeDueDate(
  input: { notificationDate: IsoDate; days: number; dayType: DayType },
  calendar: Calendar,
): DueDateResult {
  const skipped: SkippedDay[] = [];

  if (input.dayType === 'BUSINESS') {
    let cursor = input.notificationDate;
    let counted = 0;
    for (let travelled = 0; counted < input.days; travelled++) {
      if (travelled > MAX_DAYS_TRAVELLED) throw new BadRequestError(CALENDAR_TOO_BUSY);
      cursor = addDays(cursor, 1);
      const reason = calendar.nonWorkingReason(cursor);
      if (reason) skipped.push({ date: cursor, reason });
      else counted++;
    }
    return { dueDate: cursor, skipped };
  }

  let cursor = addDays(input.notificationDate, input.days);
  for (let travelled = 0; ; travelled++) {
    if (travelled > MAX_DAYS_TRAVELLED) throw new BadRequestError(CALENDAR_TOO_BUSY);
    const reason = calendar.nonWorkingReason(cursor);
    if (!reason) break;
    skipped.push({ date: cursor, reason });
    cursor = addDays(cursor, 1);
  }
  return { dueDate: cursor, skipped };
}
