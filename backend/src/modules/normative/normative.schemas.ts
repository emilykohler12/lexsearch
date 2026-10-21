import { z } from 'zod';
import type { NormativeTopic } from '../../generated/prisma/client.js';
import { isValidIsoDate, toIsoDate } from '../calendar/dates.js';
import { PRACTICE_AREAS } from '../clients/clients.schemas.js';
import { AREA_PROFILES, type FollowableArea } from './areas.js';
import { extractSummary } from './normative-analysis.js';
import type { AlertRow, ItemRow } from './normative.repository.js';

export const ALERT_STATUSES = ['NEW', 'SEEN', 'DISMISSED'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

const text = (max: number) => z.string().trim().max(max);
const areaCodes = Object.keys(AREA_PROFILES) as [FollowableArea, ...FollowableArea[]];

/** ACTIVE is what the lawyer works with: new and seen, not dismissed. */
export const alertsQuerySchema = z.object({
  status: z.enum(['ACTIVE', ...ALERT_STATUSES]).default('ACTIVE'),
});

export const updateAlertSchema = z.object({ status: z.enum(ALERT_STATUSES) });

export const itemsQuerySchema = z.object({
  /** The bulletin (BO_NACIONAL, BO_MISIONES); the first one when not given. */
  source: text(40).min(1).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener el formato AAAA-MM-DD')
    .refine(isValidIsoDate, 'La fecha no es válida')
    .optional(),
  q: text(100).default(''),
  category: text(80).default(''),
});

const keywordsSchema = z.array(text(60).min(1)).max(12);

/** An area as a whole (practiceArea) or a topic of its own (name and words). */
export const createTopicSchema = z
  .object({
    practiceArea: z.enum(areaCodes).optional(),
    name: text(80).optional(),
    keywords: keywordsSchema.default([]),
    description: text(300).default(''),
  })
  .superRefine((value, context) => {
    if (value.practiceArea) return;
    if (!value.name) context.addIssue({ code: 'custom', path: ['name'], message: 'Escribí un nombre para el tema' });
    if (value.keywords.length === 0) context.addIssue({ code: 'custom', path: ['keywords'], message: 'Agregá al menos una palabra clave' });
  });

export type CreateTopicInput = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = z
  .object({
    name: text(80).min(1).optional(),
    keywords: keywordsSchema.optional(),
    description: text(300).optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'No hay cambios para guardar');

export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;

export function areaLabel(code: string | null): string | null {
  return code && code in PRACTICE_AREAS ? PRACTICE_AREAS[code as keyof typeof PRACTICE_AREAS] : null;
}

export function toTopicDto(topic: NormativeTopic) {
  return {
    id: topic.id,
    name: topic.name,
    practiceArea: topic.practiceArea,
    keywords: topic.keywords,
    description: topic.description,
    active: topic.active,
    createdAt: topic.createdAt,
  };
}

/** The jurisdiction of a norm as it is shown: «Nación», «Misiones». */
export interface SourceTag {
  source: string;
  sourceLabel: string;
}

export function toItemDto(row: ItemRow, tag: SourceTag) {
  return {
    id: row.id,
    ...tag,
    publishedOn: toIsoDate(row.publishedOn),
    category: row.category,
    organism: row.organism,
    kind: row.kind,
    number: row.number,
    reference: row.reference,
    url: row.url,
    summary: row.summary || extractSummary(row.text),
    /** The text was read and checked against the topics (or the norm is of a kind that isn't read). */
    read: row.detailStatus === 'DONE',
    alertCount: row._count.alerts,
  };
}

export interface Affected {
  clients: number;
  cases: number;
}

export function toAlertDto(row: AlertRow, affected: Affected | null, tag: SourceTag) {
  return {
    id: row.id,
    status: row.status,
    relevance: row.relevance,
    origin: row.origin,
    reason: row.reason,
    quote: row.quote,
    quoteVerified: row.quoteVerified,
    createdAt: row.createdAt,
    topic: { id: row.topic.id, name: row.topic.name, practiceArea: row.topic.practiceArea },
    item: {
      id: row.item.id,
      ...tag,
      publishedOn: toIsoDate(row.item.publishedOn),
      category: row.item.category,
      organism: row.item.organism,
      kind: row.item.kind,
      number: row.item.number,
      reference: row.item.reference,
      url: row.item.url,
      summary: row.item.summary || extractSummary(row.item.text),
    },
    /** The clients and the open expedientes of the topic's area (null for a topic of its own). */
    affected,
  };
}
