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

  it('accepts photos and scans, read later with OCR', () => {
    expect(detectFileType('foto.JPG')).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(detectFileType('scan.tiff').kind).toBe('image');
    expect(detectFileType('captura.png').kind).toBe('image');
    expect(detectFileType('imagen.webp').kind).toBe('image');
  });

  it('explains how to send iPhone HEIC photos', () => {
    expect(() => detectFileType('IMG_1234.heic')).toThrow(/Más compatible/);
  });

  it('accepts Word 97-2003, PowerPoint and SVG', () => {
    expect(detectFileType('viejo.DOC')).toEqual({ kind: 'doc', mimeType: 'application/msword' });
    expect(detectFileType('charla.pptx').kind).toBe('pptx');
    expect(detectFileType('plano.svg')).toEqual({ kind: 'svg', mimeType: 'image/svg+xml' });
  });

  it('explains how to convert legacy .ppt files', () => {
    expect(() => detectFileType('viejo.ppt')).toThrow(/\.pptx o PDF/);
  });

  it('rejects other formats', () => {
    expect(() => detectFileType('audio.mp3')).toThrow(UnsupportedFileError);
    expect(() => detectFileType('animacion.gif')).toThrow(UnsupportedFileError);
    expect(() => detectFileType('sin-extension')).toThrow(UnsupportedFileError);
  });
});

describe('assertContentMatches', () => {
  it('accepts content that matches the extension', () => {
    expect(() => assertContentMatches('pdf', Buffer.from('%PDF-1.7\n...'), 'a.pdf')).not.toThrow();
    expect(() => assertContentMatches('docx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'a.docx')).not.toThrow();
    expect(() => assertContentMatches('text', Buffer.from('Hola, ¿qué tal?'), 'a.txt')).not.toThrow();
    expect(() => assertContentMatches('pptx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), 'a.pptx')).not.toThrow();
    expect(() => assertContentMatches('doc', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'a.doc')).not.toThrow();
    expect(() => assertContentMatches('svg', Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'a.svg')).not.toThrow();
  });

  it('rejects an SVG, a .doc or a .pptx that is something else', () => {
    expect(() => assertContentMatches('svg', Buffer.from('<html>no soy un dibujo</html>'), 'a.svg')).toThrow(UnsupportedFileError);
    expect(() => assertContentMatches('doc', Buffer.from('texto plano'), 'a.doc')).toThrow(UnsupportedFileError);
    expect(() => assertContentMatches('pptx', Buffer.from('texto plano'), 'a.pptx')).toThrow(UnsupportedFileError);
  });

  it('recognizes images by their content', () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]);
    for (const head of [jpeg, png, webp, tiff]) {
      expect(() => assertContentMatches('image', head, 'imagen')).not.toThrow();
    }
    expect(() => assertContentMatches('image', Buffer.from('%PDF-1.7'), 'falsa.jpg')).toThrow(UnsupportedFileError);
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
