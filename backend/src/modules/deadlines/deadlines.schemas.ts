import { z } from 'zod';
import { isoDateSchema } from '../calendar/calendar.schemas.js';
import type { DayType } from '../calendar/business-days.js';
import { daysBetween, toIsoDate, type IsoDate } from '../calendar/dates.js';
import type { DeadlineWithClient } from './deadlines.repository.js';

export const DAY_TYPES = {
  BUSINESS: 'Hábiles',
  CALENDAR: 'Corridos',
} as const;

export const MAX_TERM_DAYS = 365;
/** From this many days to the due date on, a pending deadline is "soon". */
export const SOON_DAYS = 3;

const dayTypeSchema = z.enum(['BUSINESS', 'CALENDAR']);
const text = (max: number) => z.string().trim().max(max);

/** What decides the due date. */
const termFields = {
  notificationDate: isoDateSchema,
  days: z.number().int().min(1, 'El plazo debe ser de al menos 1 día').max(MAX_TERM_DAYS),
  dayType: dayTypeSchema,
};

/**
 * The editable fields, with no defaults: the update schema is built from the same list, and a
 * default inside `.partial()` would silently overwrite fields the request didn't mention.
 */
const deadlineFields = {
  ...termFields,
  title: text(200).min(1),
  caseReference: text(300),
  notes: text(4_000),
  clientId: z.uuid().nullable(),
  sourceQuote: text(1_000),
};

export const calculateSchema = z.object(termFields);

export const createDeadlineSchema = z.object({
  ...termFields,
  title: deadlineFields.title,
  caseReference: deadlineFields.caseReference.default(''),
  notes: deadlineFields.notes.default(''),
  clientId: deadlineFields.clientId.default(null),
  sourceQuote: deadlineFields.sourceQuote.default(''),
});

/** Several terms of the same document, saved together. */
export const createDeadlinesBatchSchema = z.object({
  items: z.array(createDeadlineSchema).min(1).max(10),
});

export const updateDeadlineSchema = z
  .object({ ...deadlineFields, status: z.enum(['PENDING', 'DONE']) })
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Indicá al menos un campo para actualizar',
  });

export const listDeadlinesQuerySchema = z.object({
  status: z.enum(['PENDING', 'DONE']).optional(),
  clientId: z.uuid().optional(),
});

export type CalculateInput = z.infer<typeof calculateSchema>;
export type CreateDeadlineInput = z.infer<typeof createDeadlineSchema>;
export type UpdateDeadlineInput = z.infer<typeof updateDeadlineSchema>;
export type ListDeadlinesFilters = z.infer<typeof listDeadlinesQuerySchema>;

/** DONE: fulfilled. The others only apply to pending deadlines. */
export type DeadlineState = 'DONE' | 'OVERDUE' | 'TODAY' | 'SOON' | 'ONGOING';

export function deadlineState(status: string, daysLeft: number): DeadlineState {
  if (status === 'DONE') return 'DONE';
  if (daysLeft < 0) return 'OVERDUE';
  if (daysLeft === 0) return 'TODAY';
  return daysLeft <= SOON_DAYS ? 'SOON' : 'ONGOING';
}

/** `today` is Argentina's date: "overdue" depends on it, not on the server's clock. */
export function toDeadlineDto(deadline: DeadlineWithClient, today: IsoDate) {
  const dueDate = toIsoDate(deadline.dueDate);
  const daysLeft = daysBetween(today, dueDate);
  return {
    id: deadline.id,
    title: deadline.title,
    caseReference: deadline.caseReference,
    notes: deadline.notes,
    client: deadline.client,
    notificationDate: toIsoDate(deadline.notificationDate),
    days: deadline.days,
    dayType: deadline.dayType as DayType,
    dueDate,
    status: deadline.status as 'PENDING' | 'DONE',
    completedAt: deadline.completedAt,
    sourceQuote: deadline.sourceQuote,
    daysLeft,
    state: deadlineState(deadline.status, daysLeft),
    createdAt: deadline.createdAt,
    updatedAt: deadline.updatedAt,
  };
}
