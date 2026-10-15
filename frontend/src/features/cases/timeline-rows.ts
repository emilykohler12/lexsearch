import type { TimelineItem } from '../../api/types';
import { daysBetween, formatMonth } from '../../lib/format';

/** One line of the timeline: an item, or the marker that tells where today falls. */
export type TimelineRow =
  | {
      kind: 'item';
      item: TimelineItem;
      /** Days without any actuación before this one; null when it follows the previous one closely. */
      gapDays: number | null;
    }
  | { kind: 'today'; date: string };

export interface TimelineGroup {
  /** AAAA-MM */
  key: string;
  /** "marzo de 2025" */
  label: string;
  rows: TimelineRow[];
}

/** A stretch without movement shorter than this isn't worth pointing out. */
export const MIN_GAP_DAYS = 45;

/**
 * Groups the items (oldest first, as the server sends them) by month and puts the "today"
 * marker after everything dated today or earlier. The gaps are measured between actuaciones
 * that already happened: a deadline's due date or a hearing still to come is not a movement.
 */
export function buildGroups(items: TimelineItem[], today: string): TimelineGroup[] {
  const lines: Array<{ date: string; row: TimelineRow }> = [];
  let markerPlaced = false;
  let previousProceeding: string | null = null;

  const placeMarker = () => {
    lines.push({ date: today, row: { kind: 'today', date: today } });
    markerPlaced = true;
  };

  for (const item of items) {
    if (!markerPlaced && item.date > today) placeMarker();

    let gapDays: number | null = null;
    if (item.type === 'PROCEEDING' && item.date <= today) {
      if (previousProceeding !== null) {
        const days = daysBetween(previousProceeding, item.date);
        if (days >= MIN_GAP_DAYS) gapDays = days;
      }
      previousProceeding = item.date;
    }
    lines.push({ date: item.date, row: { kind: 'item', item, gapDays } });
  }
  if (items.length > 0 && !markerPlaced) placeMarker();

  const groups: TimelineGroup[] = [];
  for (const { date, row } of lines) {
    const key = date.slice(0, 7);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.rows.push(row);
    else groups.push({ key, label: formatMonth(date), rows: [row] });
  }
  return groups;
}
