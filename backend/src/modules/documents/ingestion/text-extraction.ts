import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import sharp from 'sharp';
import type { OcrEngine } from '../../ocr/ocr-engine.js';
import type { SupportedFileKind } from '../file-types.js';
import type { PageText } from './chunking.js';
import { normalizeExtractedText } from './text-normalization.js';

export interface ExtractedText {
  pages: PageText[];
  pageCount: number | null;
  charCount: number;
  /** Pages whose text was read with OCR (scans and photos); it may contain reading errors. */
  ocrPageCount: number;
}

/** Thrown for problems the user can act on (unreadable scan, password, empty file). */
export class ExtractionError extends Error {}

// A PDF page with less text than this is treated as a scan and read with OCR.
const MIN_CHARS_PER_PDF_PAGE = 25;
// Rendering scale for scanned PDF pages: ~2x the page size reads well and stays fast.
const PDF_RENDER_SCALE = 2;

const OCR_UNAVAILABLE =
  'No se pudo usar el reconocimiento de texto (OCR). La primera vez necesita conexión a internet para descargar el idioma español; probá con «Reprocesar».';

export async function extractText(kind: SupportedFileKind, data: Buffer, ocr: OcrEngine): Promise<ExtractedText> {
  const { pages, ocrPageCount } =
    kind === 'pdf'
      ? await extractPdf(data, ocr)
      : kind === 'image'
        ? await extractImage(data, ocr)
        : { pages: kind === 'docx' ? await extractDocx(data) : extractPlainText(data), ocrPageCount: 0 };

  const charCount = pages.reduce((sum, p) => sum + p.text.length, 0);
  const pageCount = kind === 'pdf' || (kind === 'image' && pages.length > 1) ? pages.length : null;

  if (charCount < MIN_CHARS_PER_PDF_PAGE && ocrPageCount > 0) {
    throw new ExtractionError(
      'No se pudo reconocer texto en el documento. Si es una foto o un escaneo, verificá que sea nítido, esté derecho y tenga buena luz.',
    );
  }
  if (charCount === 0) {
    throw new ExtractionError('El documento no tiene texto para indexar.');
  }

  return { pages: pages.filter((p) => p.text.length > 0), pageCount, charCount, ocrPageCount };
}

async function extractPdf(data: Buffer, ocr: OcrEngine): Promise<{ pages: PageText[]; ocrPageCount: number }> {
  // pdf.js may detach the buffer it receives, so hand it a copy.
  const parser = new PDFParse({ data: new Uint8Array(data), verbosity: 0 });
  try {
    let textPages: Array<{ num: number; text: string }>;
    try {
      textPages = (await parser.getText()).pages;
    } catch (error) {
      if (error instanceof Error && /password/i.test(error.name + error.message)) {
        throw new ExtractionError('El PDF está protegido con contraseña. Quitale la protección y volvé a subirlo.');
      }
      throw new ExtractionError('No se pudo leer el PDF: el archivo parece estar dañado.');
    }

    const pages: PageText[] = [];
    let ocrPageCount = 0;
    for (const page of textPages) {
      let text = normalizeExtractedText(page.text);
      // Scanned page (no text layer): render it as an image and read it.
      if (text.length < MIN_CHARS_PER_PDF_PAGE) {
        const image = await renderPdfPage(parser, page.num);
        const recognized = image ? normalizeExtractedText(await recognize(ocr, image)) : '';
        ocrPageCount++;
        if (recognized.length > text.length) text = recognized;
      }
      pages.push({ page: page.num, text });
    }
    return { pages, ocrPageCount };
  } finally {
    await parser.destroy();
  }
}

async function renderPdfPage(parser: PDFParse, pageNumber: number): Promise<Buffer | null> {
  try {
    const result = await parser.getScreenshot({
      partial: [pageNumber],
      scale: PDF_RENDER_SCALE,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const image = result.pages[0]?.data;
    return image ? Buffer.from(image) : null;
  } catch {
    throw new ExtractionError(`No se pudo convertir la página ${pageNumber} del PDF en imagen para leerla con OCR.`);
  }
}

/** Photos and scans; multi-page TIFF files (common from scanners) are read page by page. */
async function extractImage(data: Buffer, ocr: OcrEngine): Promise<{ pages: PageText[]; ocrPageCount: number }> {
  let pageTotal: number;
  try {
    pageTotal = (await sharp(data, { failOn: 'none' }).metadata()).pages ?? 1;
  } catch {
    throw new ExtractionError('No se pudo abrir la imagen: el archivo parece estar dañado.');
  }

  const pages: PageText[] = [];
  for (let index = 0; index < pageTotal; index++) {
    const image = pageTotal > 1 ? await sharp(data, { page: index, failOn: 'none' }).png().toBuffer() : data;
    const text = normalizeExtractedText(await recognize(ocr, image));
    pages.push({ page: pageTotal > 1 ? index + 1 : null, text });
  }
  return { pages, ocrPageCount: pageTotal };
}

async function recognize(ocr: OcrEngine, image: Buffer): Promise<string> {
  try {
    return (await ocr.recognize(image)).text;
  } catch {
    throw new ExtractionError(OCR_UNAVAILABLE);
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
