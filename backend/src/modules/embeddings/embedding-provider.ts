/**
 * Turns text into vectors for semantic search. Documents and queries are embedded
 * separately because some models (like e5) expect different prefixes for each.
 */
export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  embedDocuments(texts: string[]): Promise<number[][]>;
  embedQuery(text: string): Promise<number[]>;
  /** Loads the model ahead of time so the first upload doesn't pay for it. */
  warmUp(): Promise<void>;
  status(): EmbeddingStatus;
}

export type EmbeddingStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Must match the vector(N) column in the database (see prisma/schema.prisma). */
export const EMBEDDING_DIMENSIONS = 768;

/** pgvector text format: '[0.1,0.2,...]'. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
