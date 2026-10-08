import { z } from 'zod';
import type { Client } from '../../generated/prisma/client.js';

/** Areas of practice (code → label shown to the lawyer). */
export const PRACTICE_AREAS = {
  LABORAL: 'Laboral',
  CIVIL: 'Civil',
  COMERCIAL: 'Comercial',
  FAMILIA: 'Familia',
  SUCESIONES: 'Sucesiones',
  PENAL: 'Penal',
  ADMINISTRATIVO: 'Administrativo',
  PREVISIONAL: 'Previsional',
  CONSUMO: 'Consumidor',
  OTRO: 'Otro',
} as const;

export type PracticeArea = keyof typeof PRACTICE_AREAS;

export const PERSON_TYPES = {
  FISICA: 'Persona humana',
  JURIDICA: 'Persona jurídica',
} as const;

export type PersonType = keyof typeof PERSON_TYPES;

/** Long enough for the transcript of a whole first meeting. */
export const MAX_NOTES_CHARS = 60_000;

const practiceAreaSchema = z.enum(Object.keys(PRACTICE_AREAS) as [PracticeArea, ...PracticeArea[]]);
const personTypeSchema = z.enum(Object.keys(PERSON_TYPES) as [PersonType, ...PersonType[]]);

const text = (max: number) => z.string().trim().max(max);

const emailFormat = z.email();
const isEmailOrEmpty = (value: string) => value === '' || emailFormat.safeParse(value).success;

export const checklistItemSchema = z.object({
  id: z.string().trim().min(1).max(64),
  text: z.string().trim().min(1).max(300),
  done: z.boolean(),
});

export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/**
 * The editable fields, with no defaults: the update schema is built from the same list, and a
 * default inside `.partial()` would silently overwrite fields the request didn't mention.
 */
const clientFields = {
  fullName: text(200).min(1),
  personType: personTypeSchema,
  documentNumber: text(40),
  email: text(200).refine(isEmailOrEmpty, { message: 'Email inválido' }),
  phone: text(60),
  address: text(300),
  counterpartyName: text(200),
  counterpartyDocument: text(40),
  counterpartyAddress: text(300),
  practiceArea: practiceAreaSchema.nullable(),
  conflictSummary: text(8_000),
  claim: text(4_000),
  checklist: z.array(checklistItemSchema).max(60),
  meetingNotes: text(MAX_NOTES_CHARS),
};

export const createClientSchema = z.object({
  fullName: clientFields.fullName,
  personType: clientFields.personType.default('FISICA'),
  documentNumber: clientFields.documentNumber.default(''),
  email: clientFields.email.default(''),
  phone: clientFields.phone.default(''),
  address: clientFields.address.default(''),
  counterpartyName: clientFields.counterpartyName.default(''),
  counterpartyDocument: clientFields.counterpartyDocument.default(''),
  counterpartyAddress: clientFields.counterpartyAddress.default(''),
  practiceArea: clientFields.practiceArea.default(null),
  conflictSummary: clientFields.conflictSummary.default(''),
  claim: clientFields.claim.default(''),
  checklist: clientFields.checklist.default([]),
  meetingNotes: clientFields.meetingNotes.default(''),
});

export const updateClientSchema = z
  .object(clientFields)
  .partial()
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Indicá al menos un campo para actualizar',
  });

export const analyzeNotesSchema = z.object({
  notes: text(MAX_NOTES_CHARS).min(20, 'Pegá las notas o la transcripción de la reunión (al menos 20 caracteres)'),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/** The checklist is stored as JSON; anything unreadable counts as an empty list. */
export function parseChecklist(value: unknown): ChecklistItem[] {
  const parsed = z.array(checklistItemSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function toClientDto(client: Client) {
  return {
    id: client.id,
    fullName: client.fullName,
    personType: client.personType as PersonType,
    documentNumber: client.documentNumber,
    email: client.email,
    phone: client.phone,
    address: client.address,
    counterpartyName: client.counterpartyName,
    counterpartyDocument: client.counterpartyDocument,
    counterpartyAddress: client.counterpartyAddress,
    practiceArea: client.practiceArea as PracticeArea | null,
    conflictSummary: client.conflictSummary,
    claim: client.claim,
    checklist: parseChecklist(client.checklist),
    meetingNotes: client.meetingNotes,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}

export type ClientSummaryRow = Pick<
  Client,
  'id' | 'fullName' | 'personType' | 'documentNumber' | 'practiceArea' | 'counterpartyName' | 'checklist' | 'createdAt' | 'updatedAt'
>;

/** What the list needs: no notes or long texts, and the checklist reduced to counts. */
export function toClientSummaryDto(client: ClientSummaryRow) {
  const checklist = parseChecklist(client.checklist);
  return {
    id: client.id,
    fullName: client.fullName,
    personType: client.personType as PersonType,
    documentNumber: client.documentNumber,
    practiceArea: client.practiceArea as PracticeArea | null,
    counterpartyName: client.counterpartyName,
    pendingDocuments: checklist.filter((item) => !item.done).length,
    totalDocuments: checklist.length,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
  };
}
