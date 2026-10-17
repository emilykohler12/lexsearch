import { z } from 'zod';
import type { Contradiction } from '../../generated/prisma/client.js';

/** What a contradiction is about (code → label shown to the lawyer). */
export const FINDING_KINDS = {
  FECHA: 'Fecha',
  MONTO: 'Monto',
  DECLARACION: 'Declaración',
  OTRO: 'Otro',
} as const;

export type FindingKind = keyof typeof FINDING_KINDS;

/** DIRECTA: the statements can't both be true. POSIBLE: they might be reconciled; the lawyer has to look. */
export const FINDING_CONFIDENCES = {
  DIRECTA: 'Directa',
  POSIBLE: 'Posible',
} as const;

export type FindingConfidence = keyof typeof FINDING_CONFIDENCES;

/** Comparing needs at least two documents, and the model can only read so many at once. */
export const MIN_DOCUMENTS = 2;
export const MAX_DOCUMENTS = 8;
export const MAX_FINDINGS = 12;
export const MAX_STATEMENTS = 4;

const kindSchema = z.enum(Object.keys(FINDING_KINDS) as [FindingKind, ...FindingKind[]]);
const confidenceSchema = z.enum(Object.keys(FINDING_CONFIDENCES) as [FindingConfidence, ...FindingConfidence[]]);

const text = (max: number) => z.string().trim().max(max);

export const analyzeSchema = z.object({
  documentIds: z.array(z.uuid()).min(MIN_DOCUMENTS, 'Elegí al menos dos documentos para comparar').max(MAX_DOCUMENTS),
  /** What the lawyer wants the model to look at first (optional). */
  focus: text(500).default(''),
});

/** One of the statements that clash: where it is and what it says. The title is kept as it was when it was saved. */
export const statementSchema = z.object({
  documentId: z.uuid(),
  documentTitle: text(300),
  quote: text(1_000),
  /** False when the AI's quote wasn't found in the document: the lawyer has to check it by hand. */
  quoteVerified: z.boolean(),
});

export type Statement = z.infer<typeof statementSchema>;

export const createFindingSchema = z.object({
  kind: kindSchema,
  confidence: confidenceSchema,
  title: text(200).min(1),
  explanation: text(1_500),
  statements: z.array(statementSchema).min(2).max(MAX_STATEMENTS),
  note: text(4_000).default(''),
});

/** The findings the lawyer confirmed from one reading, saved together. */
export const createFindingsBatchSchema = z.object({
  items: z.array(createFindingSchema).min(1).max(MAX_FINDINGS),
});

export const updateFindingSchema = z.object({ note: text(4_000) });

export const findingParamsSchema = z.object({ id: z.uuid(), contradictionId: z.uuid() });

export type CreateFindingInput = z.infer<typeof createFindingSchema>;

/** The statements are stored as JSON; anything unreadable counts as an empty list. */
export function parseStatements(value: unknown): Statement[] {
  const parsed = z.array(statementSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The current title of the documents (by id): a renamed document shows its new name, a deleted one is missing. */
export type DocumentTitles = ReadonlyMap<string, string>;

export function toContradictionDto(row: Contradiction, titles: DocumentTitles) {
  return {
    id: row.id,
    caseId: row.caseId,
    kind: row.kind as FindingKind,
    confidence: row.confidence as FindingConfidence,
    title: row.title,
    explanation: row.explanation,
    note: row.note,
    statements: parseStatements(row.statements).map((statement) => {
      const currentTitle = titles.get(statement.documentId);
      return {
        ...statement,
        /** The document as it is now; null when it was deleted since. */
        document: currentTitle === undefined ? null : { id: statement.documentId, title: currentTitle },
      };
    }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type ContradictionDto = ReturnType<typeof toContradictionDto>;
