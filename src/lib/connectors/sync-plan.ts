/**
 * Which dates a sync covers. Pure, so it is unit tested.
 *
 * Only complete days are pulled (through yesterday in the client's time
 * zone). Google keeps processing the last day or two, so the nightly sync
 * re-pulls the last 30 days and the newest numbers settle on their own.
 */
import { addDays, addMonths, monthOf } from "@/lib/dates";
import type { DateRange, ISODate } from "@/lib/metrics/aggregate";

export const RECENT_DAYS = 30;
export const HISTORY_MONTHS = 13;

export type SyncKind = "recent" | "history";

export function syncWindow(kind: SyncKind, today: ISODate): DateRange {
  const end = addDays(today, -1);
  if (kind === "recent") return { start: addDays(end, -(RECENT_DAYS - 1)), end };
  return { start: addMonths(monthOf(today), -HISTORY_MONTHS), end };
}

/** A range the admin picked, kept to complete days and at most 3 years. Null if nothing is left. */
export function clipRange(range: DateRange, today: ISODate): DateRange | null {
  const end = range.end < today ? range.end : addDays(today, -1);
  const earliest = addMonths(monthOf(today), -36);
  const start = range.start > earliest ? range.start : earliest;
  return start <= end ? { start, end } : null;
}

/**
 * Rows a sync replaces: every GA4 row in the range that this run did not
 * write (older syncs, uploads of the same dates). Monthly rows count from the
 * first of the month, since monthly reports always start there.
 */
export function replaceWindow(range: DateRange): { daily: DateRange; period: DateRange } {
  return { daily: range, period: { start: monthOf(range.start), end: range.end } };
}
