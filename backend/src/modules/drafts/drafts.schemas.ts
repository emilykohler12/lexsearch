import { z } from 'zod';
import type { Draft } from '../../generated/prisma/client.js';
import { categorySchema } from '../documents/documents.schemas.js';

/** Kinds of document the agent can draft (code → label shown to the lawyer). */
export const DRAFT_TYPES = {
  CARTA_DOCUMENTO: 'Carta documento',
  CONTRATO: 'Contrato',
  DEMANDA: 'Demanda',
  CONTESTACION_DEMANDA: 'Contestación de demanda',
  ESCRITO_JUDICIAL: 'Otro escrito judicial',
  NOTA: 'Nota o intimación',
  OTRO: 'Otro documento',
} as const;

export type DraftType = keyof typeof DRAFT_TYPES;

const draftTypeSchema = z.enum(Object.keys(DRAFT_TYPES) as [DraftType, ...DraftType[]]);

export const createDraftSchema = z.object({
  documentType: draftTypeSchema,
  title: z.string().trim().max(200).optional(),
  instructions: z.string().trim().min(3).max(4000),
  caseDetails: z.string().trim().max(8000).default(''),
  templateDocumentId: z.uuid().optional(),
  categories: z.array(categorySchema).max(10).optional(),
});

export const updateDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().max(200_000).optional(),
  })
  .refine((data) => data.title !== undefined || data.content !== undefined, {
    message: 'Indicá al menos un campo para actualizar (title o content)',
  });

export type CreateDraftInput = z.infer<typeof createDraftSchema>;

/** Library material the agent consulted while drafting. */
export interface DraftSource {
  kind: 'fragment' | 'document';
  documentId: string;
  documentTitle: string;
  chunkId?: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  content?: string;
}

export function toDraftDto(draft: Draft) {
  return {
    id: draft.id,
    title: draft.title,
    documentType: draft.documentType,
    instructions: draft.instructions,
    caseDetails: draft.caseDetails,
    templateDocumentId: draft.templateDocumentId,
    content: draft.content,
    sources: draft.sources as unknown as DraftSource[],
    model: draft.model,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function toDraftSummaryDto(draft: Pick<Draft, 'id' | 'title' | 'documentType' | 'createdAt' | 'updatedAt'>) {
  return {
    id: draft.id,
    title: draft.title,
    documentType: draft.documentType,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}
