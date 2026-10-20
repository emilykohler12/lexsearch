import { describe, expect, it } from 'vitest';
import { BadRequestError, safeErrorMessage, UpstreamError } from '../../src/lib/errors.js';

describe('safeErrorMessage', () => {
  it('keeps the messages written for the lawyer', () => {
    expect(safeErrorMessage(new UpstreamError('LLM_BUSY', 'Gemini no está disponible en este momento.'))).toBe('Gemini no está disponible en este momento.');
    expect(safeErrorMessage(new BadRequestError('El expediente no existe'))).toBe('El expediente no existe');
  });

  it('never stores the message of any other error, which could repeat part of the case', () => {
    expect(safeErrorMessage(new Error('Invalid prompt: Juan Pérez, DNI 20.123.456'))).toBe('Error interno');
    expect(safeErrorMessage('texto con datos del cliente')).toBe('Error interno');
    expect(safeErrorMessage(undefined)).toBe('Error interno');
  });
});
