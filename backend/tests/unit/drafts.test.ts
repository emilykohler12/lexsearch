import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdownBlocks } from '../../src/modules/drafts/markdown-blocks.js';
import {
  buildDraftRequest,
  cleanDraftMarkdown,
  fileNameFrom,
  parseDraftResponse,
  titleFromDraft,
} from '../../src/modules/drafts/drafts.service.js';

describe('parseInline', () => {
  it('reads bold and italic', () => {
    expect(parseInline('Intimo en **48 horas** bajo *apercibimiento*.')).toEqual([
      { text: 'Intimo en ' },
      { text: '48 horas', bold: true },
      { text: ' bajo ' },
      { text: 'apercibimiento', italic: true },
      { text: '.' },
    ]);
  });

  it('leaves underscores inside words and placeholders alone', () => {
    expect(parseInline('archivo_final_v2 y [COMPLETAR: DNI]')).toEqual([{ text: 'archivo_final_v2 y [COMPLETAR: DNI]' }]);
  });

  it('keeps signature lines as they are', () => {
    expect(parseInline('Firma: ________________ **LOCADOR**')).toEqual([
      { text: 'Firma: ________________ ' },
      { text: 'LOCADOR', bold: true },
    ]);
  });
});

describe('parseMarkdownBlocks', () => {
  it('reads the structure of a draft, keeping single line breaks', () => {
    const blocks = parseMarkdownBlocks(
      ['# CARTA DOCUMENTO', '', 'Remitente: Juan', 'Domicilio: [COMPLETAR]', '', '## Intimación', '- primero', '1. PRIMERA: objeto', '---'].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 1, runs: [{ text: 'CARTA DOCUMENTO' }] },
      { type: 'paragraph', lines: [[{ text: 'Remitente: Juan' }], [{ text: 'Domicilio: [COMPLETAR]' }]] },
      { type: 'heading', level: 2, runs: [{ text: 'Intimación' }] },
      { type: 'bullet', runs: [{ text: 'primero' }] },
      { type: 'numbered', marker: '1.', runs: [{ text: 'PRIMERA: objeto' }] },
      { type: 'rule' },
    ]);
  });

  it('treats a line of underscores as a place to sign, not as a rule', () => {
    expect(parseMarkdownBlocks('________________\n**LOCADORA**')).toEqual([
      { type: 'paragraph', lines: [[{ text: '________________' }], [{ text: 'LOCADORA', bold: true }]] },
    ]);
  });
});

describe('draft helpers', () => {
  it('removes a markdown fence around the whole draft', () => {
    expect(cleanDraftMarkdown('```markdown\n# Título\n\nTexto\n```')).toBe('# Título\n\nTexto');
    expect(cleanDraftMarkdown('# Sin cerco')).toBe('# Sin cerco');
  });

  it('separates the "Título:" line from the document, inside or outside the fence', () => {
    const document = '# CARTA DOCUMENTO\n\nIntimo a usted.';
    expect(parseDraftResponse(`Título: CD a Ejemplo S.A.\n\n${document}`)).toEqual({ title: 'CD a Ejemplo S.A.', content: document });
    expect(parseDraftResponse(`**Título:** «CD a Ejemplo S.A.»\n\n\`\`\`markdown\n${document}\n\`\`\``)).toEqual({
      title: 'CD a Ejemplo S.A.',
      content: document,
    });
    expect(parseDraftResponse(`\`\`\`markdown\nTitulo: CD a Ejemplo S.A.\n${document}\n\`\`\``)).toEqual({
      title: 'CD a Ejemplo S.A.',
      content: document,
    });
    expect(parseDraftResponse(document)).toEqual({ title: null, content: document });
  });

  it('takes the title from the first heading, or the document type', () => {
    expect(titleFromDraft('Intro\n# **Contrato de locación**\ntexto', 'CONTRATO')).toBe('Contrato de locación');
    expect(titleFromDraft('Sin título', 'CARTA_DOCUMENTO')).toBe('Carta documento');
  });

  it('builds safe file names', () => {
    expect(fileNameFrom('Carta documento: despido / Pérez')).toBe('Carta documento - despido - Pérez');
    expect(fileNameFrom('???')).toBe('borrador');
  });

  it('tells the agent about the base model and missing data', () => {
    const message = buildDraftRequest(
      { documentType: 'CONTRATO', instructions: 'Locación comercial por 3 años', caseDetails: '', categories: ['MODELO'] },
      { id: '11111111-2222-4333-8444-555555555555', title: 'Modelo locación' },
    );
    expect(message).toContain('Tipo de documento: Contrato');
    expect(message).toContain('documento_id: 11111111-2222-4333-8444-555555555555');
    expect(message).toContain('[COMPLETAR');
    expect(message).toContain('Modelo propio');
  });
});
