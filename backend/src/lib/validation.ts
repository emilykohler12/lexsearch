import { z } from 'zod';
import { BadRequestError } from './errors.js';

// Validation messages in Spanish for the whole app.
z.config(z.locales.es());

/** Validates request input; controllers call this instead of trusting req.body/params/query. */
export function parseInput<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      field: issue.path.join('.') || null,
      message: issue.message,
    }));
    const first = issues[0];
    const summary = first ? `${first.field ? `${first.field}: ` : ''}${first.message}` : 'Datos inválidos';
    throw new BadRequestError(summary, issues);
  }
  return result.data;
}

export const uuidParamsSchema = z.object({ id: z.uuid() });
