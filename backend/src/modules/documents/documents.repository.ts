import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type Document,
  type DocumentCategory,
  type DocumentStatus,
  type PrismaClient,
} from '../../generated/prisma/client.js';
import { toVectorLiteral } from '../embeddings/embedding-provider.js';
import type { TextChunk } from './ingestion/chunking.js';

export interface DocumentFilters {
  category?: DocumentCategory | undefined;
  status?: DocumentStatus | undefined;
}

export interface NewDocument {
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storagePath: string;
  category: DocumentCategory;
}

export interface IndexedDocumentMeta {
  pageCount: number | null;
  charCount: number;
  embeddingModel: string;
}

const INSERT_BATCH_SIZE = 100;

export class DocumentsRepository {
  constructor(private readonly db: PrismaClient) {}

  findById(id: string): Promise<Document | null> {
    return this.db.document.findUnique({ where: { id } });
  }

  findBySha256(sha256: string): Promise<Document | null> {
    return this.db.document.findUnique({ where: { sha256 } });
  }

  list(filters: DocumentFilters): Promise<Document[]> {
    return this.db.document.findMany({
      where: { category: filters.category, status: filters.status },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(data: NewDocument): Promise<Document> {
    return this.db.document.create({ data });
  }

  update(id: string, data: { title?: string | undefined; category?: DocumentCategory | undefined }): Promise<Document> {
    return this.db.document.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.db.document.delete({ where: { id } });
  }

  /** Documents left half-way by a restart; they get queued again on startup. */
  findUnfinished(): Promise<Document[]> {
    return this.db.document.findMany({
      where: { status: { in: ['PENDING', 'PROCESSING'] } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setStatus(id: string, status: DocumentStatus, errorMessage: string | null = null): Promise<void> {
    await this.db.document.update({ where: { id }, data: { status, errorMessage } });
  }

  /** Replaces all chunks of a document and marks it READY, atomically. */
  async saveChunks(
    documentId: string,
    chunks: TextChunk[],
    embeddings: number[][],
    meta: IndexedDocumentMeta,
  ): Promise<void> {
    if (chunks.length !== embeddings.length) {
      throw new Error(`Got ${embeddings.length} embeddings for ${chunks.length} chunks`);
    }

    await this.db.$transaction(
      async (tx) => {
        await tx.documentChunk.deleteMany({ where: { documentId } });

        for (let start = 0; start < chunks.length; start += INSERT_BATCH_SIZE) {
          const rows = chunks.slice(start, start + INSERT_BATCH_SIZE).map(
            (chunk, i) => Prisma.sql`(
              ${randomUUID()}::uuid, ${documentId}::uuid, ${chunk.ordinal}, ${chunk.content},
              ${chunk.pageStart}::int, ${chunk.pageEnd}::int, ${chunk.charCount},
              ${toVectorLiteral(embeddings[start + i]!)}::vector
            )`,
          );
          await tx.$executeRaw`
            INSERT INTO document_chunks
              (id, document_id, ordinal, content, page_start, page_end, char_count, embedding)
            VALUES ${Prisma.join(rows)}`;
        }

        await tx.document.update({
          where: { id: documentId },
          data: {
            status: 'READY',
            errorMessage: null,
            chunkCount: chunks.length,
            pageCount: meta.pageCount,
            charCount: meta.charCount,
            embeddingModel: meta.embeddingModel,
            processedAt: new Date(),
          },
        });
      },
      { timeout: 120_000 },
    );
  }
}
