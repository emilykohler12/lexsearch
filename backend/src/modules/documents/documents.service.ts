import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type Document, type DocumentCategory } from '../../generated/prisma/client.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { FileStorage } from '../../lib/file-storage.js';
import type { DocumentFilters, DocumentsRepository } from './documents.repository.js';
import { assertContentMatches, detectFileType, UnsupportedFileError } from './file-types.js';
import type { IngestionQueue } from './ingestion/ingestion-queue.js';

export interface IncomingFile {
  tempPath: string;
  originalName: string;
  sizeBytes: number;
}

export type UploadOutcome =
  | { status: 'created' | 'duplicate'; originalName: string; document: Document }
  | { status: 'rejected'; originalName: string; message: string };

interface DocumentsServiceDeps {
  repository: DocumentsRepository;
  storage: FileStorage;
  queue: IngestionQueue;
}

export class DocumentsService {
  constructor(private readonly deps: DocumentsServiceDeps) {}

  async upload(
    files: IncomingFile[],
    options: { category: DocumentCategory; title?: string | undefined },
  ): Promise<UploadOutcome[]> {
    const outcomes: UploadOutcome[] = [];
    // One by one: keeps memory bounded and duplicate detection simple.
    for (const file of files) {
      const title = files.length === 1 ? options.title : undefined;
      outcomes.push(await this.uploadOne(file, options.category, title));
    }
    return outcomes;
  }

  list(filters: DocumentFilters): Promise<Document[]> {
    return this.deps.repository.list(filters);
  }

  async get(id: string): Promise<Document> {
    const document = await this.deps.repository.findById(id);
    if (!document) throw new NotFoundError('El documento no existe o fue eliminado');
    return document;
  }

  async getFile(id: string): Promise<{ absolutePath: string; mimeType: string; originalName: string }> {
    const document = await this.get(id);
    return {
      absolutePath: this.deps.storage.absolutePath(document.storagePath),
      mimeType: document.mimeType,
      originalName: document.originalName,
    };
  }

  async update(id: string, data: { title?: string | undefined; category?: DocumentCategory | undefined }) {
    await this.get(id);
    return this.deps.repository.update(id, data);
  }

  async delete(id: string): Promise<void> {
    const document = await this.get(id);
    await this.deps.repository.delete(id); // chunks are removed by ON DELETE CASCADE
    await this.deps.storage.remove(document.storagePath);
  }

  async reprocess(id: string): Promise<Document> {
    const document = await this.get(id);
    if (document.status === 'PENDING' || document.status === 'PROCESSING') {
      throw new ConflictError('El documento ya se está procesando');
    }
    await this.deps.repository.setStatus(id, 'PENDING');
    this.deps.queue.enqueue(id);
    return this.get(id);
  }

  /** Re-queues documents interrupted by a restart. */
  async resumeUnfinished(): Promise<number> {
    const unfinished = await this.deps.repository.findUnfinished();
    for (const document of unfinished) this.deps.queue.enqueue(document.id);
    return unfinished.length;
  }

  private async uploadOne(
    file: IncomingFile,
    category: DocumentCategory,
    title: string | undefined,
  ): Promise<UploadOutcome> {
    const { repository, storage, queue } = this.deps;
    try {
      const type = detectFileType(file.originalName);
      const data = await readFile(file.tempPath);
      assertContentMatches(type.kind, data, file.originalName);

      const sha256 = createHash('sha256').update(data).digest('hex');
      const existing = await repository.findBySha256(sha256);
      if (existing) {
        await rm(file.tempPath, { force: true });
        return { status: 'duplicate', originalName: file.originalName, document: existing };
      }

      const storagePath = await storage.moveIn(file.tempPath, path.extname(file.originalName));
      try {
        const document = await repository.create({
          title: title || titleFromFileName(file.originalName),
          originalName: file.originalName,
          mimeType: type.mimeType,
          sizeBytes: file.sizeBytes,
          sha256,
          storagePath,
          category,
        });
        queue.enqueue(document.id);
        return { status: 'created', originalName: file.originalName, document };
      } catch (error) {
        await storage.remove(storagePath);
        // Same file uploaded twice at the same time: the unique sha256 wins.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const winner = await repository.findBySha256(sha256);
          if (winner) return { status: 'duplicate', originalName: file.originalName, document: winner };
        }
        throw error;
      }
    } catch (error) {
      await rm(file.tempPath, { force: true });
      if (error instanceof UnsupportedFileError) {
        return { status: 'rejected', originalName: file.originalName, message: error.message };
      }
      throw error;
    }
  }
}

/** "Ley_20744_LCT.pdf" -> "Ley 20744 LCT" */
export function titleFromFileName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  return base.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim() || fileName;
}
