import JSZip from 'jszip';
import WordExtractor from 'word-extractor';
import type { PageText } from './chunking.js';
import { ExtractionError } from './text-extraction.js';
import { normalizeExtractedText } from './text-normalization.js';

/** A slide or part bigger than this once unzipped is not a presentation: it is a zip bomb. */
const MAX_PART_BYTES = 20 * 1024 * 1024;
const MAX_SLIDES = 1_000;

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decodes the five XML entities and numeric references. Nothing else (a doctype's entities are never expanded). */
export function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1]?.toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[name.toLowerCase()] ?? match;
  });
}

/** Word 97-2003 (.doc): the body text, with the footnotes and headers left out. */
export async function extractDoc(data: Buffer): Promise<PageText[]> {
  try {
    const document = await new WordExtractor().extract(data);
    return [{ page: null, text: normalizeExtractedText(document.getBody()) }];
  } catch {
    throw new ExtractionError('No se pudo leer el documento de Word: el archivo parece estar dañado o protegido con contraseña.');
  }
}

/** The text of each paragraph of a slide, one per line. */
function slideText(xml: string): string {
  const paragraphs = xml.match(/<a:p[\s>][\s\S]*?<\/a:p>/g) ?? [];
  return paragraphs
    .map((paragraph) =>
      [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
        .map((match) => decodeXmlText(match[1] ?? ''))
        .join(''),
    )
    .filter((line) => line.trim())
    .join('\n\n');
}

/** PowerPoint (.pptx): each slide is a page, so a quote can point to its slide. */
export async function extractPptx(data: Buffer): Promise<PageText[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ExtractionError('No se pudo leer la presentación: el archivo parece estar dañado.');
  }

  const slides = Object.keys(zip.files)
    .map((name) => ({ name, number: Number(/^ppt\/slides\/slide(\d+)\.xml$/.exec(name)?.[1]) }))
    .filter((slide) => Number.isInteger(slide.number))
    .sort((a, b) => a.number - b.number);
  if (slides.length === 0) throw new ExtractionError('La presentación no tiene diapositivas para leer.');
  if (slides.length > MAX_SLIDES) throw new ExtractionError(`La presentación tiene más de ${MAX_SLIDES} diapositivas: dividila y volvé a subirla.`);

  const pages: PageText[] = [];
  for (const slide of slides) {
    const entry = zip.files[slide.name]!;
    // jszip knows the unzipped size from the header before inflating anything.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (typeof size === 'number' && size > MAX_PART_BYTES) throw new ExtractionError('La presentación tiene una diapositiva demasiado grande para leerla.');
    pages.push({ page: slide.number, text: normalizeExtractedText(slideText(await entry.async('string'))) });
  }
  return pages;
}

/**
 * A drawing: only the text it holds (<text>, <title> and <desc>) is read. It is not drawn and OCR'd: rendering an
 * untrusted SVG can pull files and addresses into the picture.
 */
export function extractSvg(data: Buffer): PageText[] {
  const xml = data.toString('utf8');
  const parts = [...xml.matchAll(/<(text|title|desc)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map((match) => {
    const inner = (match[2] ?? '').replace(/<\/tspan>\s*<tspan/gi, ' <tspan').replace(/<[^>]+>/g, '').replace(/<!\[CDATA\[|\]\]>/g, '');
    return decodeXmlText(inner).replace(/\s+/g, ' ').trim();
  });
  const text = normalizeExtractedText([...new Set(parts.filter(Boolean))].join('\n\n'));
  if (!text) {
    throw new ExtractionError('El SVG no tiene texto, es solo un dibujo. Exportalo como PNG o PDF y volvé a subirlo para leerlo con OCR.');
  }
  return [{ page: null, text }];
}
