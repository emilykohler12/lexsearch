import type { StructuredInput } from '../../src/modules/llm/llm-provider.js';
import type { ModelRelevance } from '../../src/modules/normative/normative-analysis.js';
import type { FakeLlmProvider } from './fakes.js';

/** The tests run on Saturday 17 October 2026, noon in Argentina: the newest edition is Friday's. */
export const NOW = new Date('2026-10-17T15:00:00Z');
export const FRIDAY = '2026-10-16';
export const THURSDAY = '2026-10-15';
export const WEDNESDAY = '2026-10-14';

/** A collective agreement being homologated: the kind of norm a labor lawyer wants to know about. */
export const CCT_TEXT = [
  'Ciudad de Buenos Aires, 14/10/2026',
  'VISTO el Expediente N° EX-2026-10000001, la Ley de Convenciones Colectivas de Trabajo Nº 14.250, y',
  'CONSIDERANDO:',
  'Que las partes celebraron un acuerdo salarial en el marco del Convenio Colectivo de Trabajo N° 100/75.',
  'ARTÍCULO 1°.- Declárase homologado el acuerdo celebrado entre la FEDERACIÓN EJEMPLO y la CÁMARA DE EJEMPLO, que establece nuevas escalas salariales.',
  'ARTÍCULO 2°.- Regístrese.',
].join('\n');
export const CCT_QUOTE = 'Declárase homologado el acuerdo celebrado entre la FEDERACIÓN EJEMPLO y la CÁMARA DE EJEMPLO, que establece nuevas escalas salariales';

/** A change of staff: it affects no topic. */
export const STAFF_TEXT = [
  'Ciudad de Buenos Aires, 14/10/2026',
  'VISTO el Expediente N° EX-2026-20000002 y CONSIDERANDO: Que resulta necesario prorrogar las designaciones transitorias del personal.',
  'ARTÍCULO 1°.- Prorrógase por 180 días hábiles la designación transitoria del personal detallado en la planilla anexa.',
].join('\n');

/** A rule for rental contracts. */
export const RENT_TEXT = [
  'Ciudad de Buenos Aires, 15/10/2026',
  'VISTO la Ley de Alquileres y CONSIDERANDO: Que corresponde fijar el procedimiento de registro de los contratos de locación de vivienda.',
  'ARTÍCULO 1°.- Los locadores deberán registrar los contratos de locación de inmuebles destinados a vivienda dentro de los 15 días corridos de su celebración.',
].join('\n');
export const RENT_QUOTE = 'Los locadores deberán registrar los contratos de locación de inmuebles destinados a vivienda dentro de los 15 días corridos de su celebración';

interface AskedNorm {
  ref: string;
  title: string;
  /** The bulletin the model was told it comes from («Nación», «Misiones»). */
  scope: string;
}
interface AskedTopic {
  ref: string;
  name: string;
}

/** What the model was asked, read back from the message: the norms (N1…) and the topics (T1…). */
export function askedIn(input: StructuredInput<unknown>): { norms: AskedNorm[]; topics: AskedTopic[] } {
  const norms = [...input.userMessage.matchAll(/<norma-[0-9a-f]{8} id="(N\d+)"(?: ambito="([^"]*)")? titulo="([^"]*)"/g)].map((m) => ({
    ref: m[1]!,
    scope: m[2] ?? '',
    title: m[3]!,
  }));
  const topics = [...input.userMessage.matchAll(/<tema id="(T\d+)" nombre="([^"]*)"/g)].map((m) => ({ ref: m[1]!, name: m[2]! }));
  return { norms, topics };
}

/** Makes the fake model answer each request with what the test builds from the norms and topics it was asked about. */
export function respondWith(llm: FakeLlmProvider, answer: (asked: { norms: AskedNorm[]; topics: AskedTopic[] }) => ModelRelevance): void {
  llm.structuredResponder = (input) => answer(askedIn(input));
}

/** The model finds the homologated agreement relevant to the topic named «Laboral». */
export function laborAnswer({ norms, topics }: { norms: AskedNorm[]; topics: AskedTopic[] }): ModelRelevance {
  const topic = topics.find((t) => t.name === 'Laboral');
  const norm = norms.find((n) => n.title.includes('Disposición 683/2026'));
  if (!topic || !norm) return { norms: [] };
  return {
    norms: [
      {
        norm: norm.ref,
        summary: 'Homologa un acuerdo que fija nuevas escalas salariales.',
        matches: [{ topic: topic.ref, relevance: 'ALTA', reason: 'Cambia los salarios de un convenio colectivo.', quote: CCT_QUOTE }],
      },
    ],
  };
}
