/**
 * The report's date range and comparison period, read from the URL so every
 * view can be bookmarked and shared. Pure, so the rules are unit tested.
 *
 *   ?range=last_30 | this_month | last_month | qtd | ytd | last_12
 *   ?month=2026-07                   one calendar month (the default view)
 *   ?range=custom&from=…&to=…        any range
 *   &compare=previous | yoy | none   or compare=custom&cfrom=…&cto=…
 */
import {
  addDays,
  addMonths,
  daysBetween,
  formatMonth,
  formatRange,
  isISODate,
  isValidMonthParam,
  monthRange,
  shiftDateByMonths,
  wholeMonths,
} from "@/lib/dates";
import type { DateRange, ISODate } from "@/lib/metrics/aggregate";

export const PRESETS = [
  { id: "last_30", label: "Last 30 days" },
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "qtd", label: "Quarter to date" },
  { id: "ytd", label: "Year to date" },
  { id: "last_12", label: "Last 12 months" },
] as const;
export type PresetId = (typeof PRESETS)[number]["id"] | "month" | "custom";

export const COMPARE_MODES = [
  { id: "previous", label: "Previous period" },
  { id: "yoy", label: "Same period last year" },
  { id: "custom", label: "Custom range" },
  { id: "none", label: "No comparison" },
] as const;
export type CompareMode = (typeof COMPARE_MODES)[number]["id"];

/** Longest range the report will load at once. */
export const MAX_RANGE_DAYS = 3 * 366;

/** How to step back from a range: by whole months (calendar-aware) or by days. */
export type Shift = { months: number } | { days: number };

export interface ReportPeriod {
  preset: PresetId;
  range: DateRange;
  /** "July 2026", "Last 30 days"... */
  label: string;
  /** First day of the month when the range is exactly one calendar month. */
  month: string | null;
  compareMode: CompareMode;
  compareRange: DateRange | null;
  /** "June 2026" or "Jun 1 to Jun 7, 2026". */
  compareLabel: string | null;
  /** How the comparison was derived, so other windows (ads) can follow the same rule. */
  shift: Shift | null;
  /** Shown when a URL value was ignored. */
  notice: string | null;
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function presetRange(preset: Exclude<PresetId, "month" | "custom">, today: ISODate): DateRange {
  const thisMonth = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case "last_30": {
      // Platforms finish counting a day after it ends, so "last 30 days" stops yesterday.
      const end = addDays(today, -1);
      return { start: addDays(end, -29), end };
    }
    case "this_month":
      return { start: thisMonth, end: today };
    case "last_month":
      return monthRange(addMonths(thisMonth, -1));
    case "qtd": {
      const m = Number(today.slice(5, 7));
      const qStart = `${today.slice(0, 4)}-${String(m - ((m - 1) % 3)).padStart(2, "0")}-01`;
      return { start: qStart, end: today };
    }
    case "ytd":
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
    case "last_12":
      return { start: addMonths(thisMonth, -12), end: monthRange(addMonths(thisMonth, -1)).end };
  }
}

/** The step "previous period" uses for each kind of range. */
function previousShift(preset: PresetId, range: DateRange): Shift {
  switch (preset) {
    case "this_month":
      return { months: 1 }; // Oct 1 to 7 compares with Sep 1 to 7
    case "qtd":
      return { months: 3 };
    case "ytd":
      return { months: 12 };
    default: {
      const n = wholeMonths(range);
      return n ? { months: n } : { days: daysBetween(range) };
    }
  }
}

export function shiftRange(range: DateRange, shift: Shift): DateRange {
  if ("months" in shift) {
    return { start: shiftDateByMonths(range.start, -shift.months), end: shiftDateByMonths(range.end, -shift.months) };
  }
  return { start: addDays(range.start, -shift.days), end: addDays(range.end, -shift.days) };
}

const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const fmtMonthYear = (date: ISODate) => monthYear.format(new Date(`${date}T00:00:00Z`));

/** "July 2026", "Apr 2026 to Jun 2026" for whole months, else "Jul 3 to Aug 9, 2026". */
export function describeRange(range: DateRange): string {
  const n = wholeMonths(range);
  if (n === 1) return formatMonth(range.start);
  if (n > 1) return `${fmtMonthYear(range.start)} to ${fmtMonthYear(range.end)}`;
  return formatRange(range);
}

function validRange(from: unknown, to: unknown): DateRange | null {
  if (!isISODate(from) || !isISODate(to) || to < from) return null;
  const range = { start: from, end: to };
  return daysBetween(range) <= MAX_RANGE_DAYS ? range : null;
}

export function resolvePeriod(params: Params, opts: { today: ISODate; defaultMonth: string }): ReportPeriod {
  let notice: string | null = null;
  let preset: PresetId = "month";
  let range: DateRange = monthRange(opts.defaultMonth);
  let label: string | null = null;

  const rangeParam = one(params.range);
  const monthParam = one(params.month);
  const knownPreset = PRESETS.find((p) => p.id === rangeParam);

  if (knownPreset) {
    preset = knownPreset.id;
    range = presetRange(knownPreset.id, opts.today);
    label = knownPreset.label;
  } else if (rangeParam === "custom") {
    const custom = validRange(one(params.from), one(params.to));
    if (custom) {
      preset = "custom";
      range = custom;
    } else {
      notice = "That date range is not valid (ranges can be up to 3 years), so the latest month is shown.";
    }
  } else if (isValidMonthParam(monthParam)) {
    range = monthRange(`${monthParam}-01`);
  }

  const month = wholeMonths(range) === 1 ? range.start : null;
  label ??= describeRange(range);

  // Comparison
  const modeParam = one(params.compare);
  let compareMode: CompareMode = COMPARE_MODES.some((m) => m.id === modeParam) ? (modeParam as CompareMode) : "previous";
  let compareRange: DateRange | null = null;
  let shift: Shift | null = null;
  if (compareMode === "custom") {
    compareRange = validRange(one(params.cfrom), one(params.cto));
    if (!compareRange) {
      compareMode = "previous";
      notice ??= "That comparison range is not valid, so the previous period is used.";
    }
  }
  if (compareMode === "previous") shift = previousShift(preset, range);
  if (compareMode === "yoy") shift = { months: 12 };
  if (shift) compareRange = shiftRange(range, shift);

  return {
    preset,
    range,
    label,
    month,
    compareMode,
    compareRange,
    compareLabel: compareRange ? describeRange(compareRange) : null,
    shift,
    notice,
  };
}

/** Comparison window for another range (e.g. an ad campaign's dates), following the same rule. */
export function compareWindow(period: ReportPeriod, range: DateRange): DateRange | null {
  if (period.compareMode === "none") return null;
  if (range.start === period.range.start && range.end === period.range.end) return period.compareRange;
  if (period.compareMode === "custom") return null;
  if (period.compareMode === "yoy") return shiftRange(range, { months: 12 });
  return shiftRange(range, { days: daysBetween(range) });
}

/** Query string for a period, keeping the URL short for the default cases. */
export function periodQuery(p: {
  preset: PresetId;
  range: DateRange;
  compareMode: CompareMode;
  compareRange?: DateRange | null;
}): string {
  const q = new URLSearchParams();
  if (p.preset === "month") q.set("month", p.range.start.slice(0, 7));
  else if (p.preset === "custom") {
    q.set("range", "custom");
    q.set("from", p.range.start);
    q.set("to", p.range.end);
  } else q.set("range", p.preset);
  if (p.compareMode !== "previous") q.set("compare", p.compareMode);
  if (p.compareMode === "custom" && p.compareRange) {
    q.set("cfrom", p.compareRange.start);
    q.set("cto", p.compareRange.end);
  }
  return q.toString();
}
