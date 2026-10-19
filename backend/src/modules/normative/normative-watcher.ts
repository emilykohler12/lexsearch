import cron from 'node-cron';
import type { NormativeItem, NormativeTopic } from '../../generated/prisma/client.js';
import { AppError } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import { addDays, ARGENTINA_TIME_ZONE, dayOfWeek, toIsoDate, todayInArgentina, type IsoDate } from '../calendar/dates.js';
import {
  BATCH_SIZE,
  condenseText,
  headlineOf,
  isAnalyzableCategory,
  profileOf,
  type AnalysisItem,
  type TopicProfile,
} from './normative-analysis.js';
import type { NormativeAnalyzer } from './normative-analyzer.js';
import type { NewAlert, NormativeRepository } from './normative.repository.js';
import {
  SourceConnectionError,
  SourceRateLimitedError,
  SourceUnavailableError,
  type EditionListing,
  type ListedNorm,
  type NormativeSource,
} from './sources/normative-source.js';

export type RunStatus = 'OK' | 'PARTIAL' | 'ERROR' | 'NO_EDITION';

export interface EditionOutcome {
  /** The bulletin it belongs to (NormativeSource.id). */
  source: string;
  date: IsoDate;
  status: RunStatus;
  found: number;
  alerts: number;
  error?: string;
}

export interface RefreshSummary {
  editions: EditionOutcome[];
  newAlerts: number;
}

/** Business days looked at on each check, counting from the newest edition (the first check after a pause catches up). */
const LOOKBACK_DAYS = 3;
/** A topic added today is checked against the norms of the last days, not only against the ones that come. */
const ANALYSIS_WINDOW_DAYS = 10;
/** Norms that never produced an alert are forgotten after this long. */
const RETENTION_DAYS = 90;
/** Failures in a row (a site that answers with errors) after which the texts of the day are left for the next check. */
const MAX_CONSECUTIVE_READ_FAILURES = 3;
/** Norms whose text is read in one check: the site is read gently, the rest goes on in the next one. */
const MAX_TEXTS_PER_CHECK = 100;
/** When texts are left over, the next check comes soon, not at the next hour of the schedule. */
const FOLLOW_UP_MS = 2 * 60_000;
/** A little more than the site asked for. */
const RETRY_MARGIN_MS = 5_000;
const STARTUP_DELAY_MS = 20_000;
const HOUR_MS = 3_600_000;

const isWeekend = (date: IsoDate) => [0, 6].includes(dayOfWeek(date));

/** The days (business days only) before a date, newest first. */
function previousBusinessDays(from: IsoDate, count: number): IsoDate[] {
  const days: IsoDate[] = [];
  let cursor = from;
  while (days.length < count) {
    cursor = addDays(cursor, -1);
    if (!isWeekend(cursor)) days.push(cursor);
  }
  return days;
}

/** How long a site asked to wait (a little more, to be safe); null when the error isn't a request to wait. */
const waitAsked = (error: unknown): number | null => (error instanceof SourceRateLimitedError ? error.retryAfterMs + RETRY_MARGIN_MS : null);

interface NormativeWatcherDeps {
  /** The bulletins to read (national, provincial…): each one is checked on its own. */
  sources: NormativeSource[];
  repository: NormativeRepository;
  analyzer: NormativeAnalyzer;
  logger: Logger;
  /** Injectable so tests can pick the date. */
  now?: () => Date;
}

interface EditionStats {
  found: number;
  alerts: number;
  failed: number;
  error: string;
}

/** What checking one bulletin gave. */
interface SourceResult {
  editions: EditionOutcome[];
  newAlerts: number;
  /** When to check it again (it asked to wait, or there is work left over); null if it doesn't need it. */
  retryInMs: number | null;
}

/**
 * Reads the bulletins, stores what they published and warns about the norms that touch the topics the
 * lawyer follows. Safe to run as often as needed: what was already read and analyzed is not repeated.
 */
export class NormativeWatcher {
  private running: Promise<RefreshSummary> | null = null;
  /** Something changed while a check was running (a new topic): another one follows it. */
  private rerunRequested = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private retryAt: number | null = null;
  private readonly now: () => Date;

  constructor(private readonly deps: NormativeWatcherDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  /** When the next check was scheduled (a site asked to wait, or there was work left over); null if none. */
  get retryScheduledAt(): number | null {
    return this.retryAt;
  }

  /** Cancels the check that was scheduled for later. */
  stop(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retryAt = null;
  }

  /** Runs a check, or joins the one that is already running (two at once would read the sites twice). */
  refresh(): Promise<RefreshSummary> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          this.requestRefresh();
        }
      });
    }
    return this.running;
  }

  /**
   * Asks for a check in the background: now, or right after the one that is running (which may have
   * started before what changed). The caller doesn't wait for it.
   */
  requestRefresh(): void {
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    this.refresh().catch((error: unknown) => this.deps.logger.error({ err: error }, 'Normative check failed'));
  }

  /**
   * Starts a check in the background when the last one is older than `maxAgeMs` (for any bulletin).
   * Returns whether it started one. The screen asks for this when it opens: the computer may have been
   * off at the usual hours.
   */
  async ensureFresh(maxAgeMs = 6 * HOUR_MS): Promise<boolean> {
    if (this.running) return false;
    const now = this.now().getTime();
    const lastRuns = await Promise.all(this.deps.sources.map((source) => this.deps.repository.lastRun(source.id)));
    if (lastRuns.every((last) => last && now - last.finishedAt.getTime() < maxAgeMs)) return false;
    this.requestRefresh();
    return true;
  }

  /**
   * Checks shortly after starting (if the last check is old) and then every three hours: the bulletins
   * come out after midnight and this computer may be off at any given time. Returns the function that stops it.
   */
  start(): () => void {
    const { logger } = this.deps;
    const startup = setTimeout(() => {
      this.ensureFresh(3 * HOUR_MS).catch((error: unknown) => logger.error({ err: error }, 'Normative check failed'));
    }, STARTUP_DELAY_MS);
    startup.unref();

    const task = cron.schedule(
      '20 */3 * * *',
      () => {
        this.refresh().catch((error: unknown) => logger.error({ err: error }, 'Normative check failed'));
      },
      { timezone: ARGENTINA_TIME_ZONE, name: 'normative-watcher', noOverlap: true, unref: true },
    );
    return () => {
      clearTimeout(startup);
      void task.destroy();
      this.stop();
    };
  }

  private async run(): Promise<RefreshSummary> {
    const { sources, repository, logger } = this.deps;
    // This check is the one that was waited for: it asks for another only if it needs one.
    this.stop();
    const today = todayInArgentina(this.now());
    const startedAt = this.now();
    const topics = await repository.listActiveTopics();

    const editions: EditionOutcome[] = [];
    const retries: number[] = [];
    let newAlerts = 0;

    // Each bulletin on its own: one that is down, or that asks to wait, doesn't hold back the other.
    for (const source of sources) {
      const result = await this.checkSource(source, topics, today, startedAt);
      editions.push(...result.editions);
      newAlerts += result.newAlerts;
      if (result.retryInMs !== null) retries.push(result.retryInMs);
    }

    await repository
      .deleteOldWithoutAlerts(addDays(today, -RETENTION_DAYS))
      .catch((error: unknown) => logger.error({ err: error }, 'Could not clean up old norms'));

    if (retries.length > 0) this.scheduleRetry(Math.min(...retries));

    logger.info({ editions: editions.length, newAlerts }, 'Normative check finished');
    return { editions, newAlerts };
  }

  /** Reads the newest editions of one bulletin, their texts, and compares them with the topics. */
  private async checkSource(source: NormativeSource, topics: NormativeTopic[], today: IsoDate, startedAt: Date): Promise<SourceResult> {
    const { repository, logger } = this.deps;

    const failed = async (date: IsoDate, error: unknown): Promise<SourceResult> => {
      const message = this.describe(source, error);
      await repository.upsertRun({ source: source.id, editionDate: date, status: 'ERROR', itemsFound: 0, alertsCreated: 0, error: message, startedAt, finishedAt: this.now() });
      return { editions: [{ source: source.id, date, status: 'ERROR', found: 0, alerts: 0, error: message }], newAlerts: 0, retryInMs: waitAsked(error) };
    };

    // The newest edition is always read again: it may have grown since the last check.
    let latest: EditionListing;
    try {
      latest = await source.listEdition();
    } catch (error) {
      logger.error({ err: error, source: source.id }, 'Could not read the newest edition of the bulletin');
      return failed(today, error);
    }
    if (!latest.editionDate || latest.items.length === 0) {
      // A business day's edition always has norms: an empty page means the site changed.
      return failed(
        latest.editionDate ?? today,
        new SourceUnavailableError(`No se pudo interpretar la página del Boletín Oficial (${source.shortLabel}): puede que haya cambiado su formato.`),
      );
    }

    const outcomes: EditionOutcome[] = [];
    const listings: Array<{ date: IsoDate; listing: EditionListing }> = [{ date: latest.editionDate, listing: latest }];
    let waitMs: number | null = null;

    for (const date of previousBusinessDays(latest.editionDate, LOOKBACK_DAYS - 1)) {
      const done = await repository.findRun(source.id, date);
      if (done?.status === 'OK' || done?.status === 'NO_EDITION') continue;
      try {
        const listing = await source.listEdition(date);
        if (listing.editionDate !== date || listing.items.length === 0) {
          // Holidays and the like: the site gives back another edition or none.
          await repository.upsertRun({ source: source.id, editionDate: date, status: 'NO_EDITION', itemsFound: 0, alertsCreated: 0, error: '', startedAt, finishedAt: this.now() });
          outcomes.push({ source: source.id, date, status: 'NO_EDITION', found: 0, alerts: 0 });
          continue;
        }
        listings.push({ date, listing });
      } catch (error) {
        logger.error({ err: error, source: source.id, date }, 'Could not read an earlier edition of the bulletin');
        outcomes.push({ source: source.id, date, status: 'ERROR', found: 0, alerts: 0, error: this.describe(source, error) });
        waitMs = waitAsked(error);
        break; // the site is failing: don't insist
      }
    }

    const stats = new Map<IsoDate, EditionStats>();
    for (const { date, listing } of listings) {
      await repository.addListed(source.id, listing.items, isAnalyzableCategory);
      stats.set(date, { found: listing.items.length, alerts: 0, failed: 0, error: '' });
    }

    // Without topics there is nothing to compare with: the texts are read when the first one exists.
    let followUpMs: number | null = null;
    let newAlerts = 0;
    if (topics.length > 0) {
      const since = addDays(latest.editionDate, -ANALYSIS_WINDOW_DAYS);

      // The texts pending from the whole window, not only from today's editions: a topic added later
      // is checked against the last days too.
      const reading = await this.readTexts(source, since);
      for (const [date, failedCount] of reading.failedByDate) {
        const stat = stats.get(date);
        if (stat) {
          stat.failed += failedCount;
          stat.error ||= reading.error;
        }
      }
      if (reading.retryAfterMs !== null) followUpMs = reading.retryAfterMs + RETRY_MARGIN_MS;
      else if (reading.remaining > 0) followUpMs = FOLLOW_UP_MS;
      if (reading.aborted) {
        // Some texts are still pending: the editions of this check aren't complete.
        for (const stat of stats.values()) {
          stat.failed++;
          stat.error ||= reading.error;
        }
      }

      const analysis = await this.analyze(source, topics, since);
      for (const [date, count] of analysis.alertsByDate) {
        // Also the alerts for older editions (a topic added later checks the last days again).
        newAlerts += count;
        const stat = stats.get(date);
        if (stat) stat.alerts += count;
      }
      for (const date of analysis.failedDates) {
        const stat = stats.get(date);
        if (stat) {
          stat.failed++;
          stat.error ||= analysis.error;
        }
      }
    }

    for (const [date, stat] of stats) {
      const status: RunStatus = stat.failed > 0 ? 'PARTIAL' : 'OK';
      await repository.upsertRun({
        source: source.id,
        editionDate: date,
        status,
        itemsFound: stat.found,
        alertsCreated: stat.alerts,
        error: stat.error,
        startedAt,
        finishedAt: this.now(),
      });
      outcomes.push({ source: source.id, date, status, found: stat.found, alerts: stat.alerts, ...(stat.error ? { error: stat.error } : {}) });
    }

    // If the site asked to wait, nothing can be read before that: the longest wait is the one that counts.
    const delays = [waitMs, followUpMs].filter((ms): ms is number => ms !== null);
    return { editions: outcomes, newAlerts, retryInMs: delays.length > 0 ? Math.max(...delays) : null };
  }

  /**
   * Reads the text of the norms published since a date that don't have it yet (the newest first, up to a limit
   * per check). `retryAfterMs` is set when the site asked to wait; `remaining` counts the norms left for later.
   */
  private async readTexts(
    source: NormativeSource,
    since: IsoDate,
  ): Promise<{
    failedByDate: Map<IsoDate, number>;
    error: string;
    aborted: boolean;
    retryAfterMs: number | null;
    remaining: number;
  }> {
    const { repository, logger } = this.deps;
    const all = await repository.listPendingTextSince(source.id, since);
    const pending = all.slice(0, MAX_TEXTS_PER_CHECK);
    const remaining = all.length - pending.length;
    const failedByDate = new Map<IsoDate, number>();
    let error = '';
    let inARow = 0;

    for (const item of pending) {
      try {
        await repository.saveText(item.id, condenseText(await source.fetchText(this.listedFrom(item))));
        inARow = 0;
      } catch (cause) {
        const date = toIsoDate(item.publishedOn);
        failedByDate.set(date, (failedByDate.get(date) ?? 0) + 1);
        error ||= this.describe(source, cause);
        inARow++;
        // No connection, or the site asked to wait: nothing is wrong with the norm, so it keeps its turn.
        if (cause instanceof SourceRateLimitedError) return { failedByDate, error, aborted: true, retryAfterMs: cause.retryAfterMs, remaining };
        if (cause instanceof SourceConnectionError) return { failedByDate, error, aborted: true, retryAfterMs: null, remaining };
        logger.warn({ err: cause, source: source.id, externalId: item.externalId }, 'Could not read the text of a norm');
        await repository.markTextFailed(item.id);
        if (inARow >= MAX_CONSECUTIVE_READ_FAILURES) return { failedByDate, error, aborted: true, retryAfterMs: null, remaining };
      }
    }
    return { failedByDate, error, aborted: false, retryAfterMs: null, remaining };
  }

  /** Another check later (a site asked to wait, or there was work left over); one pending at most. */
  private scheduleRetry(ms: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryAt = this.now().getTime() + ms;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryAt = null;
      this.requestRefresh();
    }, ms);
    this.retryTimer.unref();
  }

  /** Compares the norms of one bulletin that were read with the topics they haven't been checked against yet. */
  private async analyze(
    source: NormativeSource,
    topics: NormativeTopic[],
    since: IsoDate,
  ): Promise<{ alertsByDate: Map<IsoDate, number>; failedDates: Set<IsoDate>; error: string }> {
    const { repository, analyzer } = this.deps;
    const profiles = new Map<string, TopicProfile>(topics.map((topic) => [topic.id, profileOf(topic)]));
    const result = { alertsByDate: new Map<IsoDate, number>(), failedDates: new Set<IsoDate>(), error: '' };

    // Norms with the same topics still to check go together, so a batch is made of comparable work.
    const groups = new Map<string, { topicIds: string[]; items: NormativeItem[] }>();
    for (const item of await repository.listReadSince(source.id, since)) {
      const missing = topics.filter((topic) => !item.analyzedTopicIds.includes(topic.id)).map((topic) => topic.id);
      if (missing.length === 0) continue;
      const key = missing.join(',');
      const group = groups.get(key) ?? { topicIds: missing, items: [] };
      group.items.push(item);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      const groupProfiles = group.topicIds.map((id) => profiles.get(id)).filter((profile) => profile !== undefined);
      for (let start = 0; start < group.items.length; start += BATCH_SIZE) {
        const batch = group.items.slice(start, start + BATCH_SIZE);
        try {
          const analyses = await analyzer.classify(
            batch.map((item) => this.analysisItem(source, item)),
            groupProfiles,
            { editionDate: toIsoDate(batch[0]!.publishedOn) },
          );

          const alerts: NewAlert[] = [];
          for (const item of batch) {
            const analysis = analyses.get(item.id);
            if (!analysis) continue;
            if (analysis.summary) await repository.setSummary(item.id, analysis.summary);
            for (const match of analysis.matches) {
              alerts.push({
                itemId: item.id,
                topicId: match.topicId,
                relevance: match.relevance,
                origin: match.origin,
                reason: match.reason,
                quote: match.quote,
                quoteVerified: match.quoteVerified,
              });
              const date = toIsoDate(item.publishedOn);
              result.alertsByDate.set(date, (result.alertsByDate.get(date) ?? 0) + 1);
            }
          }
          await repository.createAlerts(alerts);
          await repository.markAnalyzed(batch, group.topicIds);
        } catch (error) {
          // The model is failing (busy, out of quota): the rest waits for the next check.
          this.deps.logger.error({ err: error, source: source.id }, 'Could not analyze a batch of norms');
          result.error ||= this.describe(source, error);
          for (const item of batch) result.failedDates.add(toIsoDate(item.publishedOn));
          return result;
        }
      }
    }
    return result;
  }

  private listedFrom(item: NormativeItem): ListedNorm {
    return {
      externalId: item.externalId,
      publishedOn: toIsoDate(item.publishedOn),
      category: item.category,
      organism: item.organism,
      kind: item.kind,
      number: item.number,
      reference: item.reference,
      url: item.url,
    };
  }

  private analysisItem(source: NormativeSource, item: NormativeItem): AnalysisItem {
    return { id: item.id, headline: headlineOf(item), jurisdiction: source.shortLabel, text: item.text };
  }

  /** A message that is safe to show: what went wrong in words, never an internal error. */
  private describe(source: NormativeSource, error: unknown): string {
    if (error instanceof SourceUnavailableError || error instanceof AppError) return error.message;
    this.deps.logger.error({ err: error, source: source.id }, 'Unexpected error in the normative check');
    return `Ocurrió un error inesperado al revisar el Boletín Oficial (${source.shortLabel}).`;
  }
}
