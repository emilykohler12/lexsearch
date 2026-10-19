import { z } from 'zod';
import { locateQuote, locateQuoteLoosely } from '../llm/quote-locator.js';
import { MAX_PREPARE, MAX_STRENGTHS, MAX_WEAKNESSES, type HearingFeedback, type QuoteSource } from './hearings.schemas.js';

/**
 * What the model returns when the practice ends. It points at what the lawyer said (or wrote); each
 * phrase is checked against the conversation or the brief it names, so what is shown is her own wording.
 */
export const modelFeedbackSchema = z.object({
  summary: z.string().describe('Dos o tres oraciones neutras: cómo se desenvolvió el abogado y cuál fue el punto más importante.'),
  strengths: z
    .array(
      z.object({
        point: z.string().describe('Qué hizo bien, en una oración.'),
        quote: z.string().describe('Frase copiada textualmente de lo que dijo el abogado en la audiencia (o de su escrito) que lo muestra.'),
        source: z.string().describe('ABOGADO si la frase es de lo que dijo en la audiencia; ESCRITO si es de su escrito.'),
      }),
    )
    .describe('Lo que salió bien. Lista vacía si no hubo nada destacable.'),
  weaknesses: z
    .array(
      z.object({
        point: z.string().describe('Qué quedó flojo, en una oración: una respuesta evasiva, un dato sin respaldo, una contradicción con el escrito…'),
        why: z.string().describe('Por qué importaría ante un juez o la contraparte, en una o dos oraciones.'),
        quote: z.string().describe('Frase copiada textualmente de lo que dijo el abogado (o de su escrito) que lo muestra; vacía si lo flojo fue lo que no dijo.'),
        source: z.string().describe('ABOGADO o ESCRITO: de dónde sale la frase.'),
        suggestion: z.string().describe('Cómo reforzarlo la próxima vez, en una o dos oraciones.'),
      }),
    )
    .describe('Lo que conviene reforzar, lo más importante primero.'),
  prepare: z.array(z.string()).describe('Qué conviene tener listo para una audiencia real: pruebas, documentos, datos o argumentos. Sin inventar normas ni fallos.'),
});

export type ModelFeedback = z.infer<typeof modelFeedbackSchema>;

const MAX_QUOTE_CHARS = 500;

const oneLine = (value: string, max: number) => value.replace(/\s+/g, ' ').trim().slice(0, max);

function normalizeSource(value: string): QuoteSource | null {
  const code = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toUpperCase();
  if (/^(ESCRIT|BRIEF|DEMAND)/.test(code)) return 'ESCRITO';
  if (/^(ABOG|AUDIEN|LETRAD|CONVERS)/.test(code)) return 'ABOGADO';
  return null;
}

interface Texts {
  /** What the lawyer said in the practice (all her answers). */
  lawyer: string;
  /** Her brief. */
  brief: string;
}

/**
 * The phrase as the text itself says it. It is looked for first where the model said it came from and then
 * in the other text (the model may mix them up); a phrase that is nowhere is not shown.
 */
function verifyQuote(raw: string, claimed: QuoteSource | null, texts: Texts): { quote: string; source: QuoteSource | null; verified: boolean } {
  if (!raw.trim()) return { quote: '', source: null, verified: false };

  const order: QuoteSource[] = claimed === 'ESCRITO' ? ['ESCRITO', 'ABOGADO'] : ['ABOGADO', 'ESCRITO'];
  for (const source of order) {
    const text = source === 'ABOGADO' ? texts.lawyer : texts.brief;
    const found = locateQuote(text, raw) ?? locateQuoteLoosely(text, raw);
    if (found) return { quote: oneLine(text.slice(found.start, found.end), MAX_QUOTE_CHARS), source, verified: true };
  }
  return { quote: '', source: null, verified: false };
}

/** Cleans what the model returned and checks each phrase against what the lawyer said and wrote. */
export function normalizeFeedback(raw: ModelFeedback, texts: Texts): HearingFeedback {
  const point = (item: { point: string; quote: string; source: string }) => {
    const checked = verifyQuote(item.quote, normalizeSource(item.source), texts);
    return { point: oneLine(item.point, 300), quote: checked.quote, quoteSource: checked.source, quoteVerified: checked.verified };
  };

  return {
    summary: oneLine(raw.summary, 800),
    strengths: raw.strengths
      .map(point)
      .filter((item) => item.point)
      .slice(0, MAX_STRENGTHS),
    weaknesses: raw.weaknesses
      .map((item) => ({ ...point(item), why: oneLine(item.why, 600), suggestion: oneLine(item.suggestion, 600) }))
      .filter((item) => item.point)
      .slice(0, MAX_WEAKNESSES),
    prepare: raw.prepare
      .map((item) => oneLine(item, 300))
      .filter(Boolean)
      .slice(0, MAX_PREPARE),
  };
}
