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
  const startLabel = sameYear ? shortFmt.format(s) : longFmt.format(s);
  return `${startLabel} to ${shortFmt.format(e)}, ${e.getUTCFullYear()}`;
}

export function daysBetween(range: DateRange): number {
  return Math.round((parse(range.end).getTime() - parse(range.start).getTime()) / 86_400_000) + 1;
}
