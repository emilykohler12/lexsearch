import { z } from 'zod';
import type { HearingSimulation, HearingTurn } from '../../generated/prisma/client.js';

/** Who the AI plays (code → label shown to the lawyer). */
export const HEARING_ROLES = {
  JUDGE: 'Juez',
  OPPONENT: 'Contraparte',
} as const;

export type HearingRole = keyof typeof HEARING_ROLES;

export type HearingStatus = 'ACTIVE' | 'FINISHED';

/** Where the brief (the escrito) comes from. */
export const MATERIAL_KINDS = ['DRAFT', 'DOCUMENT', 'TEXT'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];

/** What a turn of the AI is: it opens, asks, asks again about what wasn't answered, objects, or closes. */
export const TURN_KINDS = ['APERTURA', 'PREGUNTA', 'REPREGUNTA', 'OBJECION', 'CIERRE'] as const;
export type TurnKind = (typeof TURN_KINDS)[number];

export type Speaker = 'AI' | 'USER';

/** A brief shorter than this has nothing to examine. */
export const MIN_BRIEF_CHARS = 40;
/** The most that can be pasted; a library document or a draft is cut to what the model can read. */
export const MAX_PASTED_CHARS = 100_000;
/** Each answer of the lawyer, and how many she can give in one practice (the model reads the whole conversation every time). */
export const MAX_USER_TURN_CHARS = 4_000;
export const MAX_USER_TURNS = 30;

const text = (max: number) => z.string().trim().max(max);

const materialSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('DRAFT'), id: z.uuid() }),
  z.object({ kind: z.literal('DOCUMENT'), id: z.uuid() }),
  z.object({
    kind: z.literal('TEXT'),
    title: text(120).default(''),
    text: z.string().trim().min(MIN_BRIEF_CHARS, 'Pegá el texto del escrito (muy corto para practicar con él)').max(MAX_PASTED_CHARS),
  }),
]);

export type MaterialInput = z.infer<typeof materialSchema>;

export const createHearingSchema = z.object({
  role: z.enum(Object.keys(HEARING_ROLES) as [HearingRole, ...HearingRole[]]),
  material: materialSchema,
  /** The expediente whose carátula and actuaciones the AI also reads (optional). */
  caseId: z.uuid().optional(),
  /** Who the lawyer represents, and what she wants to practice (optional). */
  position: text(300).default(''),
  focus: text(300).default(''),
});

export type CreateHearingInput = z.infer<typeof createHearingSchema>;

export const sendTurnSchema = z.object({
  content: z.string().trim().min(1, 'Escribí tu respuesta').max(MAX_USER_TURN_CHARS),
});

// ── The feedback («devolución») ───────────────────────────────────────────────

export const MAX_STRENGTHS = 4;
export const MAX_WEAKNESSES = 6;
export const MAX_PREPARE = 6;

/** Where a phrase of the feedback was taken from: what the lawyer said in the practice, or her brief. */
export const QUOTE_SOURCES = ['ABOGADO', 'ESCRITO'] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

const quotedPoint = z.object({
  point: text(300),
  /** The lawyer's own words (or the brief's); empty when none could be found. */
  quote: text(600),
  quoteSource: z.enum(QUOTE_SOURCES).nullable(),
  /** False when the model's phrase wasn't found: the lawyer reads the conversation instead. */
  quoteVerified: z.boolean(),
});

export const feedbackSchema = z.object({
  summary: text(800),
  strengths: z.array(quotedPoint).max(MAX_STRENGTHS),
  weaknesses: z
    .array(
      quotedPoint.extend({
        why: text(600),
        suggestion: text(600),
      }),
    )
    .max(MAX_WEAKNESSES),
  prepare: z.array(text(300)).max(MAX_PREPARE),
});

export type HearingFeedback = z.infer<typeof feedbackSchema>;

/** The feedback is stored as JSON; anything unreadable counts as none. */
export function parseFeedback(value: unknown): HearingFeedback | null {
  const parsed = feedbackSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// ── What the screens get ──────────────────────────────────────────────────────

export function toTurnDto(row: HearingTurn) {
  return {
    id: row.id,
    index: row.index,
    speaker: row.speaker as Speaker,
    content: row.content,
    /** Only for the AI's turns. */
    kind: (row.kind || null) as TurnKind | null,
    topic: row.topic,
    /** Norms and rulings the AI named that are not in the lawyer's material: she has to check them. */
    unverifiedCitations: row.unverifiedCitations,
    createdAt: row.createdAt,
  };
}

type Linked = { case: { id: string; title: string } | null };

export type HearingRow = HearingSimulation & Linked & { turns: HearingTurn[] };
export type HearingListRow = HearingSimulation & Linked & { _count: { turns: number } };

/** Everything a practice is: its setup, the conversation so far and, when it ended, the feedback. */
export function toHearingDto(row: HearingRow) {
  return {
    id: row.id,
    title: row.title,
    role: row.role as HearingRole,
    status: row.status as HearingStatus,
    material: { kind: row.materialKind as MaterialKind, title: row.materialTitle },
    case: row.case,
    position: row.position,
    focus: row.focus,
    turns: [...row.turns].sort((a, b) => a.index - b.index).map(toTurnDto),
    feedback: parseFeedback(row.feedback),
    /** How many answers she can still give. */
    answersLeft: Math.max(MAX_USER_TURNS - row.turns.filter((turn) => turn.speaker === 'USER').length, 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

export type HearingDto = ReturnType<typeof toHearingDto>;

export function toHearingSummaryDto(row: HearingListRow) {
  return {
    id: row.id,
    title: row.title,
    role: row.role as HearingRole,
    status: row.status as HearingStatus,
    material: { kind: row.materialKind as MaterialKind, title: row.materialTitle },
    case: row.case,
    turnCount: row._count.turns,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}
