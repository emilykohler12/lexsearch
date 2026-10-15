import { z } from 'zod';
import type { NonWorkingDay } from '../../generated/prisma/client.js';
import { daysBetween, isValidIsoDate, toIsoDate } from './dates.js';

/** A real day written as AAAA-MM-DD, within the years the calendar knows how to handle. */
export const isoDateSchema = z
  .string()
  .refine(isValidIsoDate, { message: 'Fecha inválida (usá el formato AAAA-MM-DD)' })
  .refine((value) => value >= '2000-01-01' && value <= '2100-12-31', { message: 'La fecha debe estar entre los años 2000 y 2100' });

const MAX_RANGE_DAYS = 366;

export const nonWorkingDayInputSchema = z
  .object({
    startDate: isoDateSchema,
    /** Left out for a single day. */
    endDate: isoDateSchema.optional(),
    label: z.string().trim().min(1).max(120),
  })
  .refine((day) => !day.endDate || day.endDate >= day.startDate, {
    message: 'La fecha final no puede ser anterior a la inicial',
    path: ['endDate'],
  })
  .refine((day) => !day.endDate || daysBetween(day.startDate, day.endDate) < MAX_RANGE_DAYS, {
    message: 'El período no puede superar un año',
    path: ['endDate'],
  });

export type NonWorkingDayInput = z.infer<typeof nonWorkingDayInputSchema>;

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export function toNonWorkingDayDto(day: NonWorkingDay) {
  return {
    id: day.id,
    startDate: toIsoDate(day.startDate),
    endDate: toIsoDate(day.endDate),
    label: day.label,
  };
}
