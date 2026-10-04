import type { FileStorage } from '../../lib/file-storage.js';
import type { OcrEngine } from '../ocr/ocr-engine.js';
import type { DocumentsRepository } from './documents.repository.js';
import { detectFileType } from './file-types.js';
import { extractText } from './ingestion/text-extraction.js';

export interface DocumentText {
  id: string;
  title: string;
  text: string;
}

/**
 * The whole text of a library document, read again from the original file
 * (the index only keeps overlapping fragments). Used by the drafting agent to
 * follow a model contract or brief from start to end.
 */
export class DocumentTextReader {
  constructor(
    private readonly deps: { repository: DocumentsRepository; storage: FileStorage; ocr: OcrEngine },
  ) {}

  async read(documentId: string): Promise<DocumentText | null> {
    const document = await this.deps.repository.findById(documentId);
    if (!document || document.status !== 'READY') return null;

    const data = await this.deps.storage.read(document.storagePath);
    const { pages } = await extractText(detectFileType(document.originalName).kind, data, this.deps.ocr);
    return { id: document.id, title: document.title, text: pages.map((p) => p.text).join('\n\n') };
  }
}
