import { describe, expect, it } from 'vitest';
import { BadRequestError } from '../../src/lib/errors.js';
import { computeDueDate, createCalendar, type Calendar } from '../../src/modules/calendar/business-days.js';
import {
  addDays,
  dayOfWeek,
  daysBetween,
  formatIsoDateEs,
  isValidIsoDate,
  todayInArgentina,
} from '../../src/modules/calendar/dates.js';
import { easterSunday, nationalHolidays } from '../../src/modules/calendar/holidays.js';

describe('dates', () => {
  it('recognizes only real calendar days', () => {
    expect(isValidIsoDate('2026-10-08')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false); // 2026 is not a leap year
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('2026-4-31')).toBe(false);
    expect(isValidIsoDate('0050-01-01')).toBe(false);
    expect(isValidIsoDate('mañana')).toBe(false);
  });

  it('adds and counts days across months, years and leap years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
    expect(daysBetween('2026-10-08', '2026-10-23')).toBe(15);
    expect(daysBetween('2026-10-23', '2026-10-08')).toBe(-15);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
  });

  it('knows the day of the week', () => {
    expect(dayOfWeek('2026-10-08')).toBe(4); // Thursday
    expect(dayOfWeek('2026-10-10')).toBe(6); // Saturday
    expect(dayOfWeek('2026-10-11')).toBe(0); // Sunday
    expect(formatIsoDateEs('2026-10-23')).toBe('vie 23/10/2026');
  });

  it("uses Argentina's date, whatever the server's time zone is", () => {
    // 22:30 in Buenos Aires is already the next day in UTC.
    expect(todayInArgentina(new Date('2026-10-09T01:30:00Z'))).toBe('2026-10-08');
    expect(todayInArgentina(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-09');
    expect(todayInArgentina(new Date('2026-10-08T15:00:00Z'))).toBe('2026-10-08');
  });
});

describe('easterSunday', () => {
  it('matches the known dates', () => {
    expect(easterSunday(2024)).toBe('2024-03-31');
    expect(easterSunday(2025)).toBe('2025-04-20');
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(easterSunday(2028)).toBe('2028-04-16');
    expect(easterSunday(2030)).toBe('2030-04-21');
  });
});

describe('nationalHolidays', () => {
  it('gives the official list of 2026', () => {
    const holidays = nationalHolidays(2026);
    expect(holidays.map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-02-16', // Carnaval
      '2026-02-17',
      '2026-03-24',
      '2026-04-02', // Malvinas, which is also Holy Thursday
      '2026-04-03', // Good Friday
      '2026-05-01',
      '2026-05-25',
      '2026-06-15', // Güemes, moved from Wednesday the 17th
      '2026-06-20', // Belgrano (Saturday, it doesn't move)
      '2026-07-09',
      '2026-08-17',
      '2026-10-12',
      '2026-11-23', // Soberanía, moved from Friday the 20th
      '2026-12-08',
      '2026-12-25',
    ]);
    const byDate = new Map(holidays.map((h) => [h.date, h.name]));
    expect(byDate.get('2026-04-02')).toContain('Jueves Santo');
    expect(byDate.get('2026-04-02')).toContain('Malvinas');
    expect(byDate.get('2026-06-15')).toContain('Güemes');
    expect(byDate.get('2026-11-23')).toContain('Soberanía');
  });

  it('moves Tuesday and Wednesday holidays back to Monday, and Thursday and Friday ones ahead', () => {
    const dates = nationalHolidays(2027).map((h) => h.date);
    expect(dates).toContain('2027-06-21'); // June 17 is a Thursday
    expect(dates).not.toContain('2027-06-17');
    expect(dates).toContain('2027-08-16'); // August 17 is a Tuesday
    expect(dates).toContain('2027-10-11'); // October 12 is a Tuesday
    expect(dates).toContain('2027-11-20'); // a Saturday: it stays
  });

  it('keeps a movable holiday in place when its Monday is already another holiday', () => {
    // June 17, 2022 was a Friday: its Monday (the 20th) is Belgrano's day, which never moves.
    const dates = nationalHolidays(2022).map((h) => h.date);
    expect(dates).toContain('2022-06-17');
    expect(dates).toContain('2022-06-20');
  });

  it('follows Easter for Carnaval and Holy Week', () => {
    const dates = nationalHolidays(2027).map((h) => h.date);
    expect(dates).toContain('2027-02-08');
    expect(dates).toContain('2027-02-09');
    expect(dates).toContain('2027-03-25'); // Holy Thursday
    expect(dates).toContain('2027-03-26'); // Good Friday
  });
});

describe('createCalendar', () => {
  const calendar = createCalendar([{ startDate: '2026-10-13', endDate: '2026-10-14', label: 'Asueto de prueba' }]);

  it('explains why a day does not count', () => {
    expect(calendar.nonWorkingReason('2026-10-10')).toBe('Sábado');
    expect(calendar.nonWorkingReason('2026-10-11')).toBe('Domingo');
    expect(calendar.nonWorkingReason('2026-10-12')).toBe('Día del Respeto a la Diversidad Cultural');
    expect(calendar.nonWorkingReason('2026-10-13')).toBe('Asueto de prueba');
    expect(calendar.nonWorkingReason('2026-10-14')).toBe('Asueto de prueba');
    expect(calendar.nonWorkingReason('2026-10-15')).toBeNull();
    expect(calendar.nonWorkingReason('2026-06-20')).toBe('Sábado'); // a holiday on a weekend is just a weekend
  });
});

describe('computeDueDate', () => {
  const national = createCalendar();

  it('counts business days from the day after the notification, skipping weekends and holidays', () => {
    // Thursday 8/10: Fri 9 (1), Sat/Sun/Mon 12 (holiday) skipped, Tue 13 (2) ... Fri 16 (5).
    expect(computeDueDate({ notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' }, national)).toEqual({
      dueDate: '2026-10-16',
      skipped: [
        { date: '2026-10-10', reason: 'Sábado' },
        { date: '2026-10-11', reason: 'Domingo' },
        { date: '2026-10-12', reason: 'Día del Respeto a la Diversidad Cultural' },
      ],
    });
  });

  it('counts a long term of 15 business days', () => {
    const result = computeDueDate({ notificationDate: '2026-10-09', days: 15, dayType: 'BUSINESS' }, national);
    expect(result.dueDate).toBe('2026-11-02');
    expect(result.skipped.map((s) => s.date)).toEqual([
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-17',
      '2026-10-18',
      '2026-10-24',
      '2026-10-25',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('starts counting the next working day even when the notification is on a weekend', () => {
    // Saturday 10/10: Sunday and the Monday holiday don't count, so Tuesday 13 is day 1.
    expect(computeDueDate({ notificationDate: '2026-10-10', days: 1, dayType: 'BUSINESS' }, national).dueDate).toBe(
      '2026-10-13',
    );
  });

  it('skips Holy Week', () => {
    // Wednesday 1/4: Thursday 2 (Jueves Santo), Friday 3 and the weekend are out; Mon 6 (1), Tue 7 (2).
    expect(computeDueDate({ notificationDate: '2026-04-01', days: 2, dayType: 'BUSINESS' }, national).dueDate).toBe(
      '2026-04-07',
    );
  });

  it('skips the days the lawyer added', () => {
    const calendar = createCalendar([{ startDate: '2026-10-13', endDate: '2026-10-14', label: 'Asueto de prueba' }]);
    const result = computeDueDate({ notificationDate: '2026-10-08', days: 5, dayType: 'BUSINESS' }, calendar);
    // Fri 9 (1), Thu 15 (2), Fri 16 (3), Mon 19 (4), Tue 20 (5).
    expect(result.dueDate).toBe('2026-10-20');
    expect(result.skipped).toContainEqual({ date: '2026-10-13', reason: 'Asueto de prueba' });
    expect(result.skipped).toContainEqual({ date: '2026-10-14', reason: 'Asueto de prueba' });
  });

  it('jumps over the January recess and the new year', () => {
    const calendar = createCalendar([{ startDate: '2027-01-01', endDate: '2027-01-31', label: 'Feria de enero' }]);
    // Wed 30/12: Thu 31 (1); all of January is out; Mon 1/2 (2), Tue 2/2 (3).
    expect(computeDueDate({ notificationDate: '2026-12-30', days: 3, dayType: 'BUSINESS' }, calendar).dueDate).toBe(
      '2027-02-02',
    );
  });

  it('counts calendar days and moves a due date that falls on a non-working day to the next working one', () => {
    // Thursday 8/10 + 10 = Sunday 18/10 → Monday 19/10.
    expect(computeDueDate({ notificationDate: '2026-10-08', days: 10, dayType: 'CALENDAR' }, national)).toEqual({
      dueDate: '2026-10-19',
      skipped: [{ date: '2026-10-18', reason: 'Domingo' }],
    });
    // Monday 5/10 + 7 = Monday 12/10 (holiday) → Tuesday 13/10.
    expect(computeDueDate({ notificationDate: '2026-10-05', days: 7, dayType: 'CALENDAR' }, national)).toEqual({
      dueDate: '2026-10-13',
      skipped: [{ date: '2026-10-12', reason: 'Día del Respeto a la Diversidad Cultural' }],
    });
  });

  it('leaves a calendar-day term alone when it ends on a working day', () => {
    expect(computeDueDate({ notificationDate: '2026-10-09', days: 4, dayType: 'CALENDAR' }, national)).toEqual({
      dueDate: '2026-10-13',
      skipped: [],
    });
  });

  it('handles leap years', () => {
    expect(computeDueDate({ notificationDate: '2028-02-25', days: 5, dayType: 'CALENDAR' }, national).dueDate).toBe(
      '2028-03-01',
    );
  });

  it('gives up with a clear error if the calendar has no working days at all', () => {
    const closed: Calendar = { nonWorkingReason: () => 'Cerrado' };
    expect(() => computeDueDate({ notificationDate: '2026-10-08', days: 1, dayType: 'BUSINESS' }, closed)).toThrow(
      BadRequestError,
    );
    expect(() => computeDueDate({ notificationDate: '2026-10-08', days: 1, dayType: 'CALENDAR' }, closed)).toThrow(
      BadRequestError,
    );
  });
});
