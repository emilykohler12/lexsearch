import type { NormativeItem, NormativeRun, NormativeTopic, Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { toDate, type IsoDate } from '../calendar/dates.js';
import type { ListedNorm } from './sources/normative-source.js';

/** An alert with the norm and the topic it is about. */
export type AlertRow = Prisma.NormativeAlertGetPayload<{ include: { item: true; topic: true } }>;
export type ItemRow = NormativeItem & { _count: { alerts: number } };

export interface NewAlert {
  itemId: string;
  topicId: string;
  relevance: string;
  origin: string;
  reason: string;
  quote: string;
  quoteVerified: boolean;
}

export interface NewTopic {
  name: string;
  practiceArea: string | null;
  keywords: string[];
  description: string;
}

export interface TopicChanges {
  name?: string | undefined;
  keywords?: string[] | undefined;
  description?: string | undefined;
  active?: boolean | undefined;
}

export interface RunRecord {
  source: string;
  editionDate: IsoDate;
  status: string;
  itemsFound: number;
  alertsCreated: number;
  error: string;
  startedAt: Date;
  finishedAt: Date;
}

/** After this many failed readings a norm's text is given up on (the norm stays listed). */
export const MAX_TEXT_ATTEMPTS = 3;

export class NormativeRepository {
  constructor(private readonly db: PrismaClient) {}

  // ── Norms ────────────────────────────────────────────────────────────────

  /** Stores the listed norms; the ones already known stay as they are. Returns how many are new. */
  async addListed(source: string, items: ListedNorm[], isAnalyzable: (category: string) => boolean): Promise<number> {
    if (items.length === 0) return 0;
    const { count } = await this.db.normativeItem.createMany({
      data: items.map((item) => ({
        source,
        externalId: item.externalId,
        publishedOn: toDate(item.publishedOn),
        category: item.category,
        organism: item.organism,
        kind: item.kind,
        number: item.number,
        reference: item.reference,
        url: item.url,
        detailStatus: isAnalyzable(item.category) ? 'PENDING' : 'SKIPPED',
      })),
      skipDuplicates: true,
    });
    return count;
  }

  /** The norms published since a date whose text hasn't been read yet, the newest first. */
  listPendingTextSince(source: string, since: IsoDate): Promise<NormativeItem[]> {
    return this.db.normativeItem.findMany({
      where: { source, publishedOn: { gte: toDate(since) }, detailStatus: 'PENDING' },
      orderBy: [{ publishedOn: 'desc' }, { externalId: 'asc' }],
    });
  }

  saveText(id: string, text: string): Promise<unknown> {
    return this.db.normativeItem.update({ where: { id }, data: { text, detailStatus: 'DONE' } });
  }

  /** One more failed reading; the norm is given up on after MAX_TEXT_ATTEMPTS. */
  async markTextFailed(id: string): Promise<void> {
    const item = await this.db.normativeItem.update({ where: { id }, data: { detailAttempts: { increment: 1 } } });
    if (item.detailAttempts >= MAX_TEXT_ATTEMPTS) {
      await this.db.normativeItem.update({ where: { id }, data: { detailStatus: 'FAILED' } });
    }
  }

  /** The norms whose text is known and that were published since a date: the ones that can be analyzed. */
  listReadSince(source: string, since: IsoDate): Promise<NormativeItem[]> {
    return this.db.normativeItem.findMany({
      where: { source, detailStatus: 'DONE', publishedOn: { gte: toDate(since) } },
      orderBy: [{ publishedOn: 'asc' }, { externalId: 'asc' }],
    });
  }

  /** Remembers which topics each norm was checked against. */
  async markAnalyzed(items: Array<{ id: string; analyzedTopicIds: string[] }>, topicIds: string[]): Promise<void> {
    await this.db.$transaction(
      items.map((item) =>
        this.db.normativeItem.update({
          where: { id: item.id },
          data: { analyzedTopicIds: [...new Set([...item.analyzedTopicIds, ...topicIds])] },
        }),
      ),
    );
  }

  /** A topic changed (its words, its description): the norms have to be checked against it again. */
  async forgetTopic(topicId: string): Promise<void> {
    await this.db.$executeRaw`UPDATE normative_items SET analyzed_topic_ids = array_remove(analyzed_topic_ids, ${topicId})`;
  }

  setSummary(id: string, summary: string): Promise<unknown> {
    return this.db.normativeItem.update({ where: { id }, data: { summary } });
  }

  /** The norms listed under one edition of a bulletin, with how many alerts each one has. */
  listItems(filter: { source: string; date: IsoDate; q: string; category: string }): Promise<ItemRow[]> {
    const where: Prisma.NormativeItemWhereInput = { source: filter.source, publishedOn: toDate(filter.date) };
    if (filter.category) where.category = filter.category;
    if (filter.q) {
      const contains = { contains: filter.q, mode: 'insensitive' } as const;
      where.OR = [{ organism: contains }, { kind: contains }, { number: contains }, { reference: contains }, { summary: contains }, { text: contains }];
    }
    return this.db.normativeItem.findMany({
      where,
      include: { _count: { select: { alerts: true } } },
      orderBy: { externalId: 'asc' },
    });
  }

  /** The newest editions of a bulletin that have norms stored, most recent first. */
  async listEditionDates(source: string, limit = 30): Promise<Date[]> {
    const rows = await this.db.normativeItem.findMany({
      where: { source },
      distinct: ['publishedOn'],
      select: { publishedOn: true },
      orderBy: { publishedOn: 'desc' },
      take: limit,
    });
    return rows.map((row) => row.publishedOn);
  }

  /** The categories an edition's norms appear under (for the filter). */
  async listCategories(source: string, date: IsoDate): Promise<string[]> {
    const rows = await this.db.normativeItem.findMany({
      where: { source, publishedOn: toDate(date) },
      distinct: ['category'],
      select: { category: true },
      orderBy: { category: 'asc' },
    });
    return rows.map((row) => row.category);
  }

  /** Norms older than a date that never produced an alert are not worth keeping. */
  async deleteOldWithoutAlerts(before: IsoDate): Promise<number> {
    const { count } = await this.db.normativeItem.deleteMany({ where: { publishedOn: { lt: toDate(before) }, alerts: { none: {} } } });
    return count;
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  /** Creates the alerts that don't exist yet (one per norm and topic). Returns how many are new. */
  async createAlerts(alerts: NewAlert[]): Promise<number> {
    if (alerts.length === 0) return 0;
    const { count } = await this.db.normativeAlert.createMany({ data: alerts, skipDuplicates: true });
    return count;
  }

  /** Newest norms first, the ones that regulate the topic directly before the ones that might affect it. */
  listAlerts(statuses: string[], limit = 100): Promise<AlertRow[]> {
    return this.db.normativeAlert.findMany({
      where: { status: { in: statuses } },
      include: { item: true, topic: true },
      orderBy: [{ item: { publishedOn: 'desc' } }, { relevance: 'asc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  findAlert(id: string): Promise<AlertRow | null> {
    return this.db.normativeAlert.findUnique({ where: { id }, include: { item: true, topic: true } });
  }

  countNew(): Promise<number> {
    return this.db.normativeAlert.count({ where: { status: 'NEW' } });
  }

  updateAlertStatus(id: string, status: string): Promise<AlertRow> {
    return this.db.normativeAlert.update({ where: { id }, data: { status }, include: { item: true, topic: true } });
  }

  markAllNewSeen(): Promise<unknown> {
    return this.db.normativeAlert.updateMany({ where: { status: 'NEW' }, data: { status: 'SEEN' } });
  }

  // ── Topics ───────────────────────────────────────────────────────────────

  listTopics(): Promise<NormativeTopic[]> {
    return this.db.normativeTopic.findMany({ orderBy: { createdAt: 'asc' } });
  }

  listActiveTopics(): Promise<NormativeTopic[]> {
    return this.db.normativeTopic.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } });
  }

  findTopic(id: string): Promise<NormativeTopic | null> {
    return this.db.normativeTopic.findUnique({ where: { id } });
  }

  findTopicByArea(practiceArea: string): Promise<NormativeTopic | null> {
    return this.db.normativeTopic.findUnique({ where: { practiceArea } });
  }

  createTopic(data: NewTopic): Promise<NormativeTopic> {
    return this.db.normativeTopic.create({ data });
  }

  updateTopic(id: string, changes: TopicChanges): Promise<NormativeTopic> {
    return this.db.normativeTopic.update({ where: { id }, data: changes });
  }

  async deleteTopic(id: string): Promise<void> {
    await this.db.normativeTopic.delete({ where: { id } });
  }

  // ── Checks ───────────────────────────────────────────────────────────────

  upsertRun(run: RunRecord): Promise<unknown> {
    const { source, editionDate, ...rest } = run;
    const date = toDate(editionDate);
    return this.db.normativeRun.upsert({
      where: { source_editionDate: { source, editionDate: date } },
      create: { source, editionDate: date, ...rest },
      update: rest,
    });
  }

  async findRun(source: string, editionDate: IsoDate): Promise<NormativeRun | null> {
    return this.db.normativeRun.findUnique({ where: { source_editionDate: { source, editionDate: toDate(editionDate) } } });
  }

  /** The latest check, whatever its result. */
  lastRun(source: string): Promise<NormativeRun | null> {
    return this.db.normativeRun.findFirst({ where: { source }, orderBy: { finishedAt: 'desc' } });
  }

  /** The newest edition that was read (completely or not). */
  async lastReadEdition(source: string): Promise<Date | null> {
    const run = await this.db.normativeRun.findFirst({
      where: { source, status: { in: ['OK', 'PARTIAL'] } },
      orderBy: { editionDate: 'desc' },
      select: { editionDate: true },
    });
    return run?.editionDate ?? null;
  }
}
