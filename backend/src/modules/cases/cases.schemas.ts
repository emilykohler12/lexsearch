import { z } from 'zod';
import { isoDateSchema } from '../calendar/calendar.schemas.js';
import { daysBetween, toIsoDate, type IsoDate } from '../calendar/dates.js';
import { PRACTICE_AREAS, type PracticeArea } from '../clients/clients.schemas.js';
import { deadlineState } from '../deadlines/deadlines.schemas.js';
import type { CaseRow, ProceedingWithDocument } from './cases.repository.js';

/** Where an expediente stands (code → label shown to the lawyer). */
export const CASE_STATUSES = {
  ACTIVE: 'En trámite',
  PAUSED: 'Paralizado',
  CLOSED: 'Archivado',
} as const;

export type CaseStatus = keyof typeof CASE_STATUSES;

/** What kind of event an actuación is (code → label). The timeline uses it for the icon and the color. */
export const PROCEEDING_KINDS = {
  ESCRITO: 'Escrito',
  RESOLUCION: 'Resolución',
  NOTIFICACION: 'Notificación',
  AUDIENCIA: 'Audiencia',
  PRUEBA: 'Prueba',
  OTRO: 'Otro',
} as const;

export type ProceedingKind = keyof typeof PROCEEDING_KINDS;

/** An expediente can be worked for a few clients at once, not for a crowd. */
export const MAX_CLIENTS_PER_CASE = 10;
/** The most actuaciones saved together (one reading of a text). */
export const MAX_PROCEEDINGS_PER_BATCH = 100;

const caseStatusSchema = z.enum(Object.keys(CASE_STATUSES) as [CaseStatus, ...CaseStatus[]]);
const proceedingKindSchema = z.enum(Object.keys(PROCEEDING_KINDS) as [ProceedingKind, ...ProceedingKind[]]);
const practiceAreaSchema = z.enum(Object.keys(PRACTICE_AREAS) as [PracticeArea, ...PracticeArea[]]);

const text = (max: number) => z.string().trim().max(max);

/**
 * The editable fields, with no defaults: the update schema is built from the same list, and a
 * default inside `.partial()` would silently overwrite fields the request didn't mention.
 */
const caseFields = {
  title: text(300).min(1),
  number: text(60),
  court: text(200),
  practiceArea: practiceAreaSchema.nullable(),
  status: caseStatusSchema,
  notes: text(8_000),
  clientIds: z.array(z.uuid()).max(MAX_CLIENTS_PER_CASE),
};

export const createCaseSchema = z.object({
  title: caseFields.title,
  number: caseFields.number.default(''),
  court: caseFields.court.default(''),
  practiceArea: caseFields.practiceArea.default(null),
  status: caseFields.status.default('ACTIVE'),
  notes: caseFields.notes.default(''),
  clientIds: caseFields.clientIds.default([]),
});

export const updateCaseSchema = z
  .object(caseFields)
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Indicá al menos un campo para actualizar',
  });

export const listCasesQuerySchema = z.object({
  status: caseStatusSchema.optional(),
  clientId: z.uuid().optional(),
});

const proceedingFields = {
  date: isoDateSchema,
  kind: proceedingKindSchema,
  title: text(200).min(1),
  description: text(4_000),
  documentId: z.uuid().nullable(),
  sourceQuote: text(1_000),
};

export const createProceedingSchema = z.object({
  date: proceedingFields.date,
  kind: proceedingFields.kind,
  title: proceedingFields.title,
  description: proceedingFields.description.default(''),
  documentId: proceedingFields.documentId.default(null),
  sourceQuote: proceedingFields.sourceQuote.default(''),
  /** AI: the lawyer confirmed a proposal read by the model. */
  source: z.enum(['MANUAL', 'AI']).default('MANUAL'),
});

/** The actuaciones of one reading, saved together: all of them or none. */
export const createProceedingsBatchSchema = z.object({
  items: z.array(createProceedingSchema).min(1).max(MAX_PROCEEDINGS_PER_BATCH),
});

export const updateProceedingSchema = z
  .object(proceedingFields)
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Indicá al menos un campo para actualizar',
  });

export const caseProceedingParamsSchema = z.object({ id: z.uuid(), proceedingId: z.uuid() });

/** The text to read: pasted, or a file sent as multipart (then it arrives in `req.file`). */
export const analyzeTextSchema = z.object({
  text: z.string().trim().min(20, 'Pegá el texto con las actuaciones (al menos 20 caracteres)').max(400_000),
});

export type CreateCaseInput = z.infer<typeof createCaseSchema>;
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;
export type ListCasesFilters = z.infer<typeof listCasesQuerySchema>;
export type CreateProceedingInput = z.infer<typeof createProceedingSchema>;
export type UpdateProceedingInput = z.infer<typeof updateProceedingSchema>;

/** What the lists and the header need; `today` is Argentina's date (the deadline states depend on it). */
function caseCommon(row: CaseRow, today: IsoDate) {
  const pending = row.deadlines; // only pending ones, soonest first
  const next = pending[0];
  const lastProceeding = row.proceedings[0];
  return {
    id: row.id,
    title: row.title,
    number: row.number,
    court: row.court,
    practiceArea: row.practiceArea as PracticeArea | null,
    status: row.status as CaseStatus,
    clients: row.clients.map((link) => link.client).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es')),
    proceedingCount: row._count.proceedings,
    lastProceedingDate: lastProceeding ? toIsoDate(lastProceeding.date) : null,
    pendingDeadlines: pending.length,
    nextDeadline: next
      ? (() => {
          const dueDate = toIsoDate(next.dueDate);
          const daysLeft = daysBetween(today, dueDate);
          return { id: next.id, title: next.title, dueDate, daysLeft, state: deadlineState(next.status, daysLeft) };
        })()
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toCaseDto(row: CaseRow, today: IsoDate) {
  return { ...caseCommon(row, today), notes: row.notes };
}

/** The list leaves out the notes. */
export function toCaseSummaryDto(row: CaseRow, today: IsoDate) {
  return caseCommon(row, today);
}

export function toProceedingDto(proceeding: ProceedingWithDocument) {
  return {
    id: proceeding.id,
    caseId: proceeding.caseId,
    date: toIsoDate(proceeding.date),
    kind: proceeding.kind as ProceedingKind,
    title: proceeding.title,
    description: proceeding.description,
    position: proceeding.position,
    source: proceeding.source as 'MANUAL' | 'AI',
    sourceQuote: proceeding.sourceQuote,
    document: proceeding.document,
    createdAt: proceeding.createdAt,
    updatedAt: proceeding.updatedAt,
  };
}

export type ProceedingDto = ReturnType<typeof toProceedingDto>;
