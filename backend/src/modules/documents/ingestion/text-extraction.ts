import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { SupportedFileKind } from '../file-types.js';
import type { PageText } from './chunking.js';
import { normalizeExtractedText } from './text-normalization.js';

export interface ExtractedText {
  pages: PageText[];
  pageCount: number | null;
  charCount: number;
}

/** Thrown for problems the user can act on (scanned PDF, password, empty file). */
export class ExtractionError extends Error {}

// Below this average, a PDF is almost certainly a scan (images without a text layer).
const MIN_CHARS_PER_PDF_PAGE = 25;

export async function extractText(kind: SupportedFileKind, data: Buffer): Promise<ExtractedText> {
  const pages =
    kind === 'pdf' ? await extractPdf(data) : kind === 'docx' ? await extractDocx(data) : extractPlainText(data);

  const charCount = pages.reduce((sum, p) => sum + p.text.length, 0);
  const pageCount = kind === 'pdf' ? pages.length : null;

  if (kind === 'pdf' && charCount < Math.max(1, pages.length) * MIN_CHARS_PER_PDF_PAGE) {
    throw new ExtractionError(
      'No se encontró texto en el PDF: parece ser un documento escaneado (imágenes). ' +
        'El reconocimiento de texto (OCR) se agrega en una próxima versión; mientras tanto, ' +
        'si tenés la versión digital del documento, subí esa.',
    );
  }
  if (charCount === 0) {
    throw new ExtractionError('El documento no tiene texto para indexar.');
  }

  return { pages: pages.filter((p) => p.text.length > 0), pageCount, charCount };
}

async function extractPdf(data: Buffer): Promise<PageText[]> {
  // pdf.js may detach the buffer it receives, so hand it a copy.
  const parser = new PDFParse({ data: new Uint8Array(data), verbosity: 0 });
  try {
    const result = await parser.getText();
    return result.pages.map((page) => ({ page: page.num, text: normalizeExtractedText(page.text) }));
  } catch (error) {
    if (error instanceof Error && /password/i.test(error.name + error.message)) {
      throw new ExtractionError('El PDF está protegido con contraseña. Quitale la protección y volvé a subirlo.');
    }
    throw new ExtractionError('No se pudo leer el PDF: el archivo parece estar dañado.');
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(data: Buffer): Promise<PageText[]> {
  try {
    const { value } = await mammoth.extractRawText({ buffer: data });
    return [{ page: null, text: normalizeExtractedText(value) }];
  } catch {
    throw new ExtractionError('No se pudo leer el documento de Word: el archivo parece estar dañado.');
  }
}

function extractPlainText(data: Buffer): PageText[] {
  return [{ page: null, text: normalizeExtractedText(data.toString('utf8')) }];
}
