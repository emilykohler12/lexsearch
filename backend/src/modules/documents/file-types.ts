import path from 'node:path';

export type SupportedFileKind = 'pdf' | 'docx' | 'text' | 'image';

interface FileTypeInfo {
  kind: SupportedFileKind;
  mimeType: string;
}

const BY_EXTENSION: Record<string, FileTypeInfo> = {
  '.pdf': { kind: 'pdf', mimeType: 'application/pdf' },
  '.docx': {
    kind: 'docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.txt': { kind: 'text', mimeType: 'text/plain; charset=utf-8' },
  '.md': { kind: 'text', mimeType: 'text/markdown; charset=utf-8' },
  // Photos and scans: their text is read with OCR.
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.tif': { kind: 'image', mimeType: 'image/tiff' },
  '.tiff': { kind: 'image', mimeType: 'image/tiff' },
};

export const ACCEPTED_EXTENSIONS = Object.keys(BY_EXTENSION);

export class UnsupportedFileError extends Error {}

/** Decides the file type from its extension; the content is checked later with {@link assertContentMatches}. */
export function detectFileType(originalName: string): FileTypeInfo {
  const extension = path.extname(originalName).toLowerCase();
  const info = BY_EXTENSION[extension];
  if (info) return info;

  if (extension === '.doc') {
    throw new UnsupportedFileError(
      `"${originalName}": los archivos .doc (Word 97-2003) no son compatibles. Guardalo como .docx o PDF desde Word y volvé a subirlo.`,
    );
  }
  if (extension === '.heic' || extension === '.heif') {
    throw new UnsupportedFileError(
      `"${originalName}": las fotos HEIC del iPhone no son compatibles. Mandalas como JPG (en el iPhone: Ajustes → Cámara → Formatos → Más compatible) o exportalas como JPG.`,
    );
  }
  throw new UnsupportedFileError(
    `"${originalName}": formato no soportado. Formatos aceptados: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
  );
}

const startsWith = (head: Buffer, bytes: number[], offset = 0) =>
  head.length >= offset + bytes.length && bytes.every((byte, i) => head[offset + i] === byte);

/** JPEG, PNG, WebP or TIFF, by their first bytes (an image with the "wrong" image extension is still fine). */
function isSupportedImage(head: Buffer): boolean {
  return (
    startsWith(head, [0xff, 0xd8, 0xff]) || // JPEG
    startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) || // PNG
    (head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') ||
    startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || // TIFF, little endian
    startsWith(head, [0x4d, 0x4d, 0x00, 0x2a]) // TIFF, big endian
  );
}

/** Rejects files whose bytes don't match their extension (e.g. an .exe renamed to .pdf). */
export function assertContentMatches(kind: SupportedFileKind, head: Buffer, originalName: string): void {
  const ok =
    kind === 'pdf'
      ? head.subarray(0, 1024).includes('%PDF-')
      : kind === 'docx'
        ? startsWith(head, [0x50, 0x4b, 0x03, 0x04]) // ZIP container
        : kind === 'image'
          ? isSupportedImage(head)
          : !head.includes(0x00); // plain text has no NUL bytes

  if (!ok) {
    throw new UnsupportedFileError(`"${originalName}": el contenido del archivo no coincide con su extensión.`);
  }
}
