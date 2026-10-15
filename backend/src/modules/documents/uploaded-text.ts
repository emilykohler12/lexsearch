import { readFile } from 'node:fs/promises';
import { BadRequestError } from '../../lib/errors.js';
import type { OcrEngine } from '../ocr/ocr-engine.js';
import type { IncomingFile } from './documents.service.js';
import { assertContentMatches, detectFileType, UnsupportedFileError } from './file-types.js';
import { ExtractionError, extractText } from './ingestion/text-extraction.js';

/**
 * Reads the text of a file the lawyer uploaded to have it analyzed (a cédula, an expediente
 * printout...): PDF, photo or scan (read with OCR), Word or plain text. The caller owns the
 * temporary file and deletes it.
 */
export async function readUploadedText(
  file: IncomingFile,
  ocr: OcrEngine,
): Promise<{ text: string; ocrPageCount: number }> {
  try {
    const type = detectFileType(file.originalName);
    const data = await readFile(file.tempPath);
    assertContentMatches(type.kind, data, file.originalName);
    const { pages, ocrPageCount } = await extractText(type.kind, data, ocr);
    return { text: pages.map((page) => page.text).join('\n\n'), ocrPageCount };
  } catch (error) {
    // Problems with the file itself are the lawyer's to fix: say so as a 400.
    if (error instanceof UnsupportedFileError || error instanceof ExtractionError) throw new BadRequestError(error.message);
    throw error;
  }
}
