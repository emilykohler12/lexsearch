import cron from 'node-cron';
import type { Logger } from '../../lib/logger.js';
import {
  addDays,
  ARGENTINA_TIME_ZONE,
  daysBetween,
  formatIsoDateEs,
  todayInArgentina,
  toDate,
  toIsoDate,
  type IsoDate,
} from '../calendar/dates.js';
import { SOON_DAYS } from '../deadlines/deadlines.schemas.js';
import type { DeadlinesRepository } from '../deadlines/deadlines.repository.js';
import type { NotificationsRepository } from './notifications.repository.js';

/** The warnings, from the earliest to the most urgent. */
export type AlertKind = 'DEADLINE_SOON_3' | 'DEADLINE_SOON_1' | 'DEADLINE_TODAY' | 'DEADLINE_OVERDUE';

/** Which warning a pending deadline deserves, by the days left until its due date. */
export function alertKindFor(daysLeft: number): AlertKind | null {
  if (daysLeft < 0) return 'DEADLINE_OVERDUE';
  if (daysLeft === 0) return 'DEADLINE_TODAY';
  if (daysLeft === 1) return 'DEADLINE_SOON_1';
  return daysLeft <= SOON_DAYS ? 'DEADLINE_SOON_3' : null;
}

export function alertMessage(kind: AlertKind, dueDate: IsoDate, daysLeft: number): string {
  const due = formatIsoDateEs(dueDate);
  switch (kind) {
    case 'DEADLINE_SOON_3':
      return `Vence en ${daysLeft} días (${due})`;
    case 'DEADLINE_SOON_1':
      return `Vence mañana (${due})`;
    case 'DEADLINE_TODAY':
      return `Vence hoy (${due})`;
    case 'DEADLINE_OVERDUE':
      return daysLeft === -1 ? `Venció ayer (${due})` : `Venció hace ${-daysLeft} días (${due})`;
  }
}

interface DeadlineWatcherDeps {
  deadlines: DeadlinesRepository;
  notifications: NotificationsRepository;
  logger: Logger;
}

/**
 * Warns about the deadlines that are about to expire (3 days, 1 day, today) or already did.
 * One warning per stage: a new, more urgent one retires the older ones.
 */
export class DeadlineWatcher {
  constructor(private readonly deps: DeadlineWatcherDeps) {}

  /** Creates the warnings that are due. Safe to run as often as needed. Returns how many it created. */
  async check(now: Date = new Date()): Promise<number> {
    const { deadlines, notifications } = this.deps;
    const today = todayInArgentina(now);
    const upcoming = await deadlines.listPendingDueBy(toDate(addDays(today, SOON_DAYS)));

    let created = 0;
    for (const deadline of upcoming) {
      const dueDate = toIsoDate(deadline.dueDate);
      const daysLeft = daysBetween(today, dueDate);
      const kind = alertKindFor(daysLeft);
      if (!kind) continue;

      const isNew = await notifications.createIfMissing({
        kind,
        deadlineId: deadline.id,
        title: deadline.title,
        message: alertMessage(kind, dueDate, daysLeft),
      });
      if (isNew) {
        created++;
        await notifications.markDeadlineRead(deadline.id, kind);
      }
    }
    return created;
  }

  /**
   * Checks now and then every hour (this computer may be off at any given time of the day, so
   * "once a day at 8" could be missed). Returns the function that stops it.
   */
  start(): () => void {
    const run = () => {
      this.check().catch((error: unknown) => this.deps.logger.error({ err: error }, 'Deadline check failed'));
    };
    run();
    const task = cron.schedule('5 * * * *', run, {
      timezone: ARGENTINA_TIME_ZONE,
      name: 'deadline-watcher',
      noOverlap: true,
      unref: true,
    });
    return () => {
      void task.destroy();
    };
  }
}
