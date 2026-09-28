import { Prisma, type DocumentCategory, type PrismaClient } from '../../generated/prisma/client.js';
import { toVectorLiteral } from '../embeddings/embedding-provider.js';

export interface SearchFilters {
  categories?: DocumentCategory[] | undefined;
  documentIds?: string[] | undefined;
}

export interface ChunkHit {
  id: string;
  documentId: string;
  ordinal: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  documentTitle: string;
  category: DocumentCategory;
  originalName: string;
  /** Cosine similarity (semantic) or ts_rank_cd (keyword); only comparable within one list. */
  score: number;
}

const HIT_COLUMNS = Prisma.sql`
  c.id, c.document_id AS "documentId", c.ordinal, c.content,
  c.page_start AS "pageStart", c.page_end AS "pageEnd",
  d.title AS "documentTitle", d.category::text AS category, d.original_name AS "originalName"`;

export class RagRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Nearest fragments by meaning (cosine distance over pgvector). */
  async semanticSearch(queryVector: number[], filters: SearchFilters, limit: number): Promise<ChunkHit[]> {
    const vector = toVectorLiteral(queryVector);
    const rows = await this.db.$queryRaw<ChunkHit[]>`
      SELECT ${HIT_COLUMNS}, 1 - (c.embedding <=> ${vector}::vector) AS score
      FROM document_chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'READY' AND c.embedding IS NOT NULL ${filterSql(filters)}
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${limit}`;
    return rows.map(normalizeHit);
  }

  /**
   * Fragments containing the query words (Spanish stemming, accent-insensitive).
   * Catches exact references that embeddings blur, like "art. 245" or "Ley 20.744".
   * Plain questions match ANY word (ranked by density); quoted text uses web-search syntax.
   */
  async keywordSearch(query: string, filters: SearchFilters, limit: number): Promise<ChunkHit[]> {
    const tsquery = query.includes('"')
      ? Prisma.sql`websearch_to_tsquery('es_unaccent', ${query})`
      : Prisma.sql`replace(plainto_tsquery('es_unaccent', ${query})::text, ' & ', ' | ')::tsquery`;

    const rows = await this.db.$queryRaw<ChunkHit[]>`
      SELECT ${HIT_COLUMNS}, ts_rank_cd(c.search_vector, q.query) AS score
      FROM (SELECT ${tsquery} AS query) q
      JOIN document_chunks c ON c.search_vector @@ q.query
      JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'READY' ${filterSql(filters)}
      ORDER BY score DESC, c.id
      LIMIT ${limit}`;
    return rows.map(normalizeHit);
  }

  countReadyDocuments(): Promise<number> {
    return this.db.document.count({ where: { status: 'READY' } });
  }
}

function filterSql(filters: SearchFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (filters.categories?.length) {
    parts.push(Prisma.sql`AND d.category::text = ANY(${filters.categories}::text[])`);
  }
  if (filters.documentIds?.length) {
    parts.push(Prisma.sql`AND d.id = ANY(${filters.documentIds}::uuid[])`);
  }
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

function normalizeHit(row: ChunkHit): ChunkHit {
  return { ...row, ordinal: Number(row.ordinal), score: Number(row.score) };
}
