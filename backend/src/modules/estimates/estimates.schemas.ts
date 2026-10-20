import { z } from 'zod';
import type { OutcomeEstimate } from '../../generated/prisma/client.js';

/** The notice that always goes with an estimate (the roadmap requires it to be visible every time). */
export const ESTIMATE_NOTICE = 'Es una orientación basada en antecedentes parecidos de tu biblioteca, no una predicción confiable.';

/** Fewer comparable, verified antecedents than this say nothing: the orientation is «insufficient». */
export const MIN_COMPARABLE = 3;
/** Share of favorable antecedents (among the favorable and unfavorable ones) from which one side predominates. */
export const PREDOMINANCE = 0.7;

export const MIN_FACTS_CHARS = 40;
export const MAX_FACTS_CHARS = 6_000;

export const ORIENTATIONS = {
  FAVORABLE: 'Antecedentes mayormente favorables',
  DIVIDED: 'Antecedentes divididos',
  UNFAVORABLE: 'Antecedentes mayormente desfavorables',
  INSUFFICIENT: 'Antecedentes insuficientes',
} as const;

export type Orientation = keyof typeof ORIENTATIONS;

export const COMPARABILITIES = ['SI', 'PARCIAL', 'NO'] as const;
export type Comparability = (typeof COMPARABILITIES)[number];

export const DIRECTIONS = ['FAVORABLE', 'DESFAVORABLE', 'NEUTRO'] as const;
export type Direction = (typeof DIRECTIONS)[number];

const text = (max: number) => z.string().trim().max(max);

export const analyzeEstimateSchema = z.object({
  facts: z.string().trim().min(MIN_FACTS_CHARS, 'Describí los hechos del caso con un poco más de detalle').max(MAX_FACTS_CHARS),
  /** What is claimed or defended (optional). */
  claim: text(500).default(''),
  /** The expediente whose carátula and actuaciones are also read (optional). */
  caseId: z.uuid().optional(),
});

export type AnalyzeEstimateInput = z.infer<typeof analyzeEstimateSchema>;

const antecedentSchema = z.object({
  documentId: z.uuid(),
  documentTitle: text(300),
  pageStart: z.number().int().nullable(),
  comparable: z.enum(COMPARABILITIES),
  direction: z.enum(DIRECTIONS),
  /** What the court decided, in one sentence. */
  holding: text(600),
  /** A phrase of the ruling; empty when it wasn't found. */
  quote: text(700),
  quoteVerified: z.boolean(),
  similarities: z.array(text(300)).max(4),
  differences: z.array(text(300)).max(4),
  /** Whether it entered the count (comparable, verified, and with a direction). */
  counted: z.boolean(),
});

export type Antecedent = z.infer<typeof antecedentSchema>;

export const estimateResultSchema = z.object({
  orientation: z.enum(Object.keys(ORIENTATIONS) as [Orientation, ...Orientation[]]),
  counts: z.object({
    favorable: z.number().int(),
    unfavorable: z.number().int(),
    neutral: z.number().int(),
    notComparable: z.number().int(),
    unverified: z.number().int(),
  }),
  /** Rulings of the library that were read. */
  searched: z.number().int(),
  antecedents: z.array(antecedentSchema),
  /** Facts that, if known, would change the assessment. */
  missingFacts: z.array(text(300)).max(6),
});

export type EstimateResult = z.infer<typeof estimateResultSchema>;

export const saveEstimateSchema = z.object({
  title: text(150).default(''),
  facts: analyzeEstimateSchema.shape.facts,
  claim: analyzeEstimateSchema.shape.claim,
  caseId: z.uuid().optional(),
  result: estimateResultSchema,
  model: text(100).default(''),
});

export type SaveEstimateInput = z.infer<typeof saveEstimateSchema>;

export const updateEstimateSchema = z.object({
  note: text(4_000),
});

/** What the analysis returns: nothing is saved until the lawyer confirms. */
export function toProposalDto(result: EstimateResult, model: string) {
  return { orientation: result.orientation, label: ORIENTATIONS[result.orientation], notice: ESTIMATE_NOTICE, result, model };
}

export type EstimateRow = OutcomeEstimate & { case: { id: string; title: string } | null };

/** The result is stored as JSON; anything unreadable counts as none. */
export function parseResult(value: unknown): EstimateResult | null {
  const parsed = estimateResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function toEstimateDto(row: EstimateRow) {
  const result = parseResult(row.result);
  return {
    id: row.id,
    title: row.title,
    facts: row.facts,
    claim: row.claim,
    case: row.case,
    orientation: result?.orientation ?? null,
    label: result ? ORIENTATIONS[result.orientation] : null,
    notice: ESTIMATE_NOTICE,
    result,
    note: row.note,
    model: row.model,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toEstimateSummaryDto(row: EstimateRow) {
  const result = parseResult(row.result);
  return {
    id: row.id,
    title: row.title,
    case: row.case,
    orientation: result?.orientation ?? null,
    label: result ? ORIENTATIONS[result.orientation] : null,
    comparable: result ? result.counts.favorable + result.counts.unfavorable + result.counts.neutral : 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
