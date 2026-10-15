/**
 * Calendar days as "YYYY-MM-DD": no time of day and no time zone, so a deadline can never shift
 * a day because of where the server runs. Dates are stored in the database as DATE columns,
 * which Prisma returns as UTC midnight: always read them with the UTC getters (toIsoDate).
 */
export type IsoDate = string;

export const ARGENTINA_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A real day of the calendar (rejects "2026-02-30"). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Midnight UTC of that day: the way the database stores it. */
export function toDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: IsoDate, days: number): IsoDate {
  return toIsoDate(new Date(toDate(value).getTime() + days * MS_PER_DAY));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(value: IsoDate): number {
  return toDate(value).getUTCDay();
}

/** Today's date in Argentina, whatever the server's own time zone is. */
export function todayInArgentina(now: Date = new Date()): IsoDate {
  // The "en-CA" locale writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ARGENTINA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const WEEKDAYS_ES = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** "vie 23/10/2026", for messages. */
export function formatIsoDateEs(value: IsoDate): string {
  const [year, month, day] = value.split('-');
  return `${WEEKDAYS_ES[dayOfWeek(value)]} ${day}/${month}/${year}`;
}
