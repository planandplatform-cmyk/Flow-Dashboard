import type { DateRange, ISODate } from "@/lib/metrics/aggregate";

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (iso: ISODate) => new Date(`${iso}T00:00:00Z`);

/** "2026-07-01" or "2026-07" -> July 1..31, 2026. */
export function monthRange(month: string): DateRange {
  const [y, m] = month.split("-").map(Number);
  return { start: toISO(new Date(Date.UTC(y, m - 1, 1))), end: toISO(new Date(Date.UTC(y, m, 0))) };
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return toISO(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

/** First day of the month containing a date. */
export function monthOf(date: ISODate): string {
  return `${date.slice(0, 7)}-01`;
}

/** True if the date is the last day of its month. */
export function isMonthEnd(date: ISODate): boolean {
  return monthRange(date).end === date;
}

export function isValidMonthParam(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const shortFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export const formatMonth = (month: string) => monthFmt.format(parse(monthOf(month)));
export const formatDay = (date: ISODate) => longFmt.format(parse(date));

/** "Jul 14 to Aug 6, 2026" (copy rule: no dashes for ranges). */
export function formatRange(range: DateRange): string {
  const s = parse(range.start);
  const e = parse(range.end);
  const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
  const startLabel = sameYear ? shortFmt.format(s) : `${shortFmt.format(s)}, ${s.getUTCFullYear()}`;
  return `${startLabel} to ${shortFmt.format(e)}, ${e.getUTCFullYear()}`;
}

export function daysBetween(range: DateRange): number {
  return Math.round((parse(range.end).getTime() - parse(range.start).getTime()) / 86_400_000) + 1;
}

export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toISO(parse(value)) === value;
}

export function addDays(date: ISODate, delta: number): ISODate {
  const d = parse(date);
  d.setUTCDate(d.getUTCDate() + delta);
  return toISO(d);
}

/** Today's date in a time zone (the client's), as YYYY-MM-DD. */
export function todayIn(timeZone: string, now = new Date()): ISODate {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return toISO(now);
  }
}

/** Number of whole calendar months the range covers exactly, or 0 if it does not. */
export function wholeMonths(range: DateRange): number {
  if (range.start.slice(8) !== "01" || !isMonthEnd(range.end) || range.end < range.start) return 0;
  const [ys, ms] = range.start.split("-").map(Number);
  const [ye, me] = range.end.split("-").map(Number);
  return (ye - ys) * 12 + (me - ms) + 1;
}

/**
 * Move a date by whole months, keeping the day of month where it exists
 * (Mar 31 minus one month is Feb 28) and keeping month ends as month ends.
 */
export function shiftDateByMonths(date: ISODate, months: number): ISODate {
  const target = addMonths(date, months);
  const last = monthRange(target).end;
  if (isMonthEnd(date)) return last;
  const day = date.slice(8);
  const candidate = `${target.slice(0, 8)}${day}`;
  return candidate > last ? last : candidate;
}

/** The first day of each month from `first` through `last` (both YYYY-MM-01). */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = monthOf(first); m <= monthOf(last) && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}

const monthShortFmt = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
/** "Jul '26" for chart axes. */
export const formatMonthShort = (month: string) => monthShortFmt.format(parse(monthOf(month))).replace(" ", " '");
