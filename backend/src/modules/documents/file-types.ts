import path from 'node:path';

export type SupportedFileKind = 'pdf' | 'docx' | 'text';

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
  throw new UnsupportedFileError(
    `"${originalName}": formato no soportado. Formatos aceptados: ${ACCEPTED_EXTENSIONS.join(', ')}.`,
  );
}

/** Rejects files whose bytes don't match their extension (e.g. an .exe renamed to .pdf). */
export function assertContentMatches(kind: SupportedFileKind, head: Buffer, originalName: string): void {
  const ok =
    kind === 'pdf'
      ? head.subarray(0, 1024).includes('%PDF-')
      : kind === 'docx'
        ? head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) // ZIP container
        : !head.includes(0x00); // plain text has no NUL bytes

  if (!ok) {
    throw new UnsupportedFileError(`"${originalName}": el contenido del archivo no coincide con su extensión.`);
  }
}
