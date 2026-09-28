import { z } from 'zod';
import { categorySchema } from '../documents/documents.schemas.js';

const filtersSchema = z.object({
  categories: z.array(categorySchema).max(10).optional(),
  documentIds: z.array(z.uuid()).max(50).optional(),
});

// Queries travel in the request body (never in the URL) so they don't end up in logs.
export const searchBodySchema = filtersSchema.extend({
  query: z.string().trim().min(2).max(1000),
  limit: z.number().int().min(1).max(30).default(10),
});

export const askBodySchema = filtersSchema.extend({
  question: z.string().trim().min(3).max(2000),
});

export type SearchInput = z.infer<typeof searchBodySchema>;
export type AskInput = z.infer<typeof askBodySchema>;
