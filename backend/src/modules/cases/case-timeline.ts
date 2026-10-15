import type { DayType } from '../calendar/business-days.js';
import type { DeadlineState, toDeadlineDto } from '../deadlines/deadlines.schemas.js';
import type { ProceedingDto, ProceedingKind } from './cases.schemas.js';

type DeadlineDto = ReturnType<typeof toDeadlineDto>;

/**
 * One entry of the timeline: something that happened in the expediente (an actuación) or the
 * day a deadline of the expediente ends.
 */
export type TimelineItem =
  | {
      type: 'PROCEEDING';
      id: string;
      date: string;
      kind: ProceedingKind;
      title: string;
      description: string;
      source: 'MANUAL' | 'AI';
      sourceQuote: string;
      document: { id: string; title: string } | null;
    }
  | {
      type: 'DEADLINE';
      id: string;
      /** The due date. */
      date: string;
      title: string;
      status: 'PENDING' | 'DONE';
      state: DeadlineState;
      daysLeft: number;
      notificationDate: string;
      days: number;
      dayType: DayType;
    };

/**
 * The actuaciones and the deadlines of an expediente in one list, oldest first. On the same day
 * the actuaciones come first (in their own order) and then the deadlines that end that day.
 */
export function buildTimeline(proceedings: ProceedingDto[], deadlines: DeadlineDto[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...proceedings.map(
      (proceeding): TimelineItem => ({
        type: 'PROCEEDING',
        id: proceeding.id,
        date: proceeding.date,
        kind: proceeding.kind,
        title: proceeding.title,
        description: proceeding.description,
        source: proceeding.source,
        sourceQuote: proceeding.sourceQuote,
        document: proceeding.document,
      }),
    ),
    ...deadlines.map(
      (deadline): TimelineItem => ({
        type: 'DEADLINE',
        id: deadline.id,
        date: deadline.dueDate,
        title: deadline.title,
        status: deadline.status,
        state: deadline.state,
        daysLeft: deadline.daysLeft,
        notificationDate: deadline.notificationDate,
        days: deadline.days,
        dayType: deadline.dayType,
      }),
    ),
  ];

  // Array.prototype.sort is stable: items of the same kind and day keep the order they came in.
  const rank = (item: TimelineItem) => (item.type === 'PROCEEDING' ? 0 : 1);
  return items.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b));
}
