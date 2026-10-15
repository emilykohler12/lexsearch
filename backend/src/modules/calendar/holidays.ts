import { addDays, dayOfWeek, type IsoDate } from './dates.js';

export interface Holiday {
  date: IsoDate;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (year: number, month: number, day: number): IsoDate => `${year}-${pad(month)}-${pad(day)}`;

/** Easter Sunday of a year (Gregorian calendar; Meeus/Jones/Butcher algorithm). */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

// Holidays that never move (Ley 27.399).
const FIXED: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: 'Año Nuevo' },
  { month: 3, day: 24, name: 'Día Nacional de la Memoria por la Verdad y la Justicia' },
  { month: 4, day: 2, name: 'Día del Veterano y de los Caídos en la Guerra de Malvinas' },
  { month: 5, day: 1, name: 'Día del Trabajador' },
  { month: 5, day: 25, name: 'Día de la Revolución de Mayo' },
  { month: 6, day: 20, name: 'Paso a la Inmortalidad del General Manuel Belgrano' },
  { month: 7, day: 9, name: 'Día de la Independencia' },
  { month: 12, day: 8, name: 'Inmaculada Concepción de María' },
  { month: 12, day: 25, name: 'Navidad' },
];

// Holidays that move to a Monday when they fall in the middle of the week (Ley 27.399, art. 6).
const MOVABLE: Array<{ month: number; day: number; name: string }> = [
  { month: 6, day: 17, name: 'Paso a la Inmortalidad del General Martín Miguel de Güemes' },
  { month: 8, day: 17, name: 'Paso a la Inmortalidad del General José de San Martín' },
  { month: 10, day: 12, name: 'Día del Respeto a la Diversidad Cultural' },
  { month: 11, day: 20, name: 'Día de la Soberanía Nacional' },
];

/** Tuesday and Wednesday go back to the Monday before; Thursday and Friday ahead to the Monday after. */
function movedToMonday(date: IsoDate): IsoDate {
  switch (dayOfWeek(date)) {
    case 2:
      return addDays(date, -1);
    case 3:
      return addDays(date, -2);
    case 4:
      return addDays(date, 4);
    case 5:
      return addDays(date, 3);
    default:
      return date; // Monday, Saturday and Sunday stay where they are
  }
}

/**
 * National holidays of a year, plus Holy Thursday (a "día no laborable" the courts don't work),
 * oldest first. They follow the rules of the law; what the Government decides year by year
 * (bridge days, exceptional moves) can't be known in advance and goes in the custom days.
 */
export function nationalHolidays(year: number): Holiday[] {
  const names = new Map<IsoDate, string[]>();
  const add = (date: IsoDate, name: string) => names.set(date, [...(names.get(date) ?? []), name]);

  const easter = easterSunday(year);
  add(addDays(easter, -48), 'Carnaval');
  add(addDays(easter, -47), 'Carnaval');
  add(addDays(easter, -3), 'Jueves Santo');
  add(addDays(easter, -2), 'Viernes Santo');

  for (const holiday of FIXED) add(isoDate(year, holiday.month, holiday.day), holiday.name);

  for (const holiday of MOVABLE) {
    const original = isoDate(year, holiday.month, holiday.day);
    const moved = movedToMonday(original);
    // A holiday doesn't move onto another one that never moves: it stays on its own day.
    const collides = FIXED.some((fixed) => isoDate(year, fixed.month, fixed.day) === moved);
    add(collides ? original : moved, holiday.name);
  }

  return [...names.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, list]) => ({ date, name: list.join(' / ') }));
}
