import type { FileStorage } from '../../../lib/file-storage.js';
import type { Logger } from '../../../lib/logger.js';
import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js';
import type { OcrEngine } from '../../ocr/ocr-engine.js';
import type { DocumentsRepository } from '../documents.repository.js';
import { detectFileType } from '../file-types.js';
import { chunkPages } from './chunking.js';
import { ExtractionError, extractText } from './text-extraction.js';

interface IngestionDeps {
  repository: DocumentsRepository;
  storage: FileStorage;
  embeddings: EmbeddingProvider;
  ocr: OcrEngine;
  logger: Logger;
}

const GENERIC_FAILURE =
  'Ocurrió un error inesperado al procesar el documento. Probá con "Reprocesar"; si vuelve a fallar, revisá los logs del servidor.';

/** Upload → text extraction (OCR for scans and photos) → chunking → embeddings → pgvector. */
export class IngestionService {
  constructor(private readonly deps: IngestionDeps) {}

  async process(documentId: string): Promise<void> {
    const { repository, storage, embeddings, ocr, logger } = this.deps;
    const document = await repository.findById(documentId);
    if (!document) return; // deleted while waiting in the queue

    const startedAt = Date.now();
    await repository.setStatus(documentId, 'PROCESSING');

    try {
      const data = await storage.read(document.storagePath);
      const { kind } = detectFileType(document.originalName);
      const extracted = await extractText(kind, data, ocr);
      const chunks = chunkPages(extracted.pages);

      // The title gives each fragment context ("Ley 20.744 ...") without altering the stored text.
      const vectors = await embeddings.embedDocuments(chunks.map((c) => `${document.title}\n${c.content}`));

      await repository.saveChunks(documentId, chunks, vectors, {
        pageCount: extracted.pageCount,
        charCount: extracted.charCount,
        ocrPageCount: extracted.ocrPageCount,
        embeddingModel: embeddings.modelName,
      });

      logger.info(
        {
          documentId,
          pages: extracted.pageCount,
          ocrPages: extracted.ocrPageCount,
          chunks: chunks.length,
          ms: Date.now() - startedAt,
        },
        'Document indexed',
      );
    } catch (error) {
      const expected = error instanceof ExtractionError;
      const message = expected ? error.message : GENERIC_FAILURE;
      logger[expected ? 'warn' : 'error']({ err: error, documentId }, 'Document processing failed');
      try {
        await repository.setStatus(documentId, 'FAILED', message);
      } catch {
        // The document may have been deleted meanwhile; nothing left to update.
      }
    }
  }
}
