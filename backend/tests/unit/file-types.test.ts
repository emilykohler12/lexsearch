import { describe, expect, it } from 'vitest';
import { titleFromFileName } from '../../src/modules/documents/documents.service.js';
import {
  assertContentMatches,
  detectFileType,
  UnsupportedFileError,
} from '../../src/modules/documents/file-types.js';

describe('detectFileType', () => {
  it('accepts PDF, Word (.docx) and text files regardless of case', () => {
    expect(detectFileType('Fallo.PDF').kind).toBe('pdf');
    expect(detectFileType('modelo.docx').kind).toBe('docx');
    expect(detectFileType('notas.txt').kind).toBe('text');
    expect(detectFileType('apuntes.md').kind).toBe('text');
  });

  it('explains how to convert legacy .doc files', () => {
    expect(() => detectFileType('viejo.doc')).toThrow(/\.docx o PDF/);
  });

  it('rejects other formats', () => {
    expect(() => detectFileType('foto.jpg')).toThrow(UnsupportedFileError);
    expect(() => detectFileType('sin-extension')).toThrow(UnsupportedFileError);
  });
});

describe('assertContentMatches', () => {
  it('accepts content that matches the extension', () => {
    expect(() => assertContentMatches('pdf', Buffer.from('%PDF-1.7\n...'), 'a.pdf')).not.toThrow();
    expect(() => assertContentMatches('docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'a.docx')).not.toThrow();
    expect(() => assertContentMatches('text', Buffer.from('Hola, ¿qué tal?'), 'a.txt')).not.toThrow();
  });

  it('rejects renamed files', () => {
    expect(() => assertContentMatches('pdf', Buffer.from('MZ\x90\x00 executable'), 'virus.pdf')).toThrow(
      UnsupportedFileError,
    );
    expect(() => assertContentMatches('text', Buffer.from([0x48, 0x00, 0x49]), 'binario.txt')).toThrow(
      UnsupportedFileError,
    );
  });
});

describe('titleFromFileName', () => {
  it('builds a readable title from the file name', () => {
    expect(titleFromFileName('Ley_20744_LCT.pdf')).toBe('Ley 20744 LCT');
    expect(titleFromFileName('Contestación de demanda - modelo.docx')).toBe('Contestación de demanda - modelo');
  });
});
