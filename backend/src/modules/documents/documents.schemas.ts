import { z } from 'zod';
import { DocumentCategory, DocumentStatus, type Document } from '../../generated/prisma/client.js';

export const categorySchema = z.enum(DocumentCategory);
export const statusSchema = z.enum(DocumentStatus);

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  LEGISLACION: 'Legislación',
  JURISPRUDENCIA: 'Jurisprudencia',
  DOCTRINA: 'Doctrina',
  MODELO: 'Modelo propio',
  ESCRITO: 'Escrito',
  OTRO: 'Otro',
};

export const uploadFieldsSchema = z.object({
  category: categorySchema.default('OTRO'),
  /** Only applied when a single file is uploaded. */
  title: z.string().trim().max(300).optional(),
});

export const listDocumentsQuerySchema = z.object({
  category: categorySchema.optional(),
  status: statusSchema.optional(),
});

export const updateDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    category: categorySchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.category !== undefined, {
    message: 'Indicá al menos un campo para actualizar (title o category)',
  });

/** Public shape of a document: never exposes where the file is stored. */
export function toDocumentDto(document: Document) {
  return {
    id: document.id,
    title: document.title,
    originalName: document.originalName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    category: document.category,
    status: document.status,
    errorMessage: document.errorMessage,
    pageCount: document.pageCount,
    chunkCount: document.chunkCount,
    charCount: document.charCount,
    processedAt: document.processedAt,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

export type DocumentDto = ReturnType<typeof toDocumentDto>;
