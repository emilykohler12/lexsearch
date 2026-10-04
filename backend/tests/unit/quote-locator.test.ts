import { describe, expect, it } from 'vitest';
import { locateQuote } from '../../src/modules/llm/quote-locator.js';

const content =
  'CLÁUSULA QUINTA: RESCISIÓN ANTICIPADA\n\nTranscurridos los primeros seis meses de vigencia, LA LOCATARIA podrá rescindir el contrato notificando en forma fehaciente a LA LOCADORA con una antelación mínima de sesenta días.';

const textAt = (match: { start: number; end: number } | null) => (match ? content.slice(match.start, match.end) : null);

describe('locateQuote', () => {
  it('finds an exact quote', () => {
    const match = locateQuote(content, 'con una antelación mínima de sesenta días');
    expect(textAt(match)).toBe('con una antelación mínima de sesenta días');
  });

  it('ignores case, extra spaces and line breaks', () => {
    const match = locateQuote(content, 'rescisión  anticipada transcurridos los primeros');
    expect(textAt(match)).toBe('RESCISIÓN ANTICIPADA\n\nTranscurridos los primeros');
  });

  it('ignores surrounding quotation marks and ellipsis', () => {
    expect(textAt(locateQuote(content, '«LA LOCATARIA podrá rescindir el contrato»'))).toBe(
      'LA LOCATARIA podrá rescindir el contrato',
    );
    expect(textAt(locateQuote(content, '…notificando en forma fehaciente…'))).toBe('notificando en forma fehaciente');
  });

  it('anchors on the longest piece when the model elides text in the middle', () => {
    const match = locateQuote(content, 'Transcurridos los primeros seis meses ... sesenta días');
    expect(textAt(match)).toBe('Transcurridos los primeros seis meses');
  });

  it('rejects quotes that are not in the fragment', () => {
    expect(locateQuote(content, 'deberá abonar una indemnización de tres meses')).toBeNull();
    expect(locateQuote(content, '  ')).toBeNull();
  });
});
