/**
 * Roll metrics up over any date range, following each metric's aggregation
 * rule from config.ts. Pure functions: callers fetch rows, this computes.
 */
import { METRICS } from "./config";

/** ISO date string, YYYY-MM-DD. Lexicographic compare == chronological. */
export type ISODate = string;

export interface DateRange {
  start: ISODate;
  end: ISODate; // inclusive
}

export interface DailyRow {
  metric_key: string;
  date: ISODate;
  value: number;
  dimension?: string;
  dimension_value?: string;
}

export interface PeriodRow {
  metric_key: string;
  period_start: ISODate;
  period_end: ISODate;
  value: number;
  dimension?: string;
  dimension_value?: string;
}

export interface MetricData {
  daily: DailyRow[];
  period: PeriodRow[];
}

export interface ResolvedValue {
  value: number | null;
  /** true when a unique metric had no exact period value and was approximated. */
  estimated: boolean;
}

export interface DimensionFilter {
  dimension: string;
  value: string;
}

const NULL_VALUE: ResolvedValue = { value: null, estimated: false };

function matchesDimension(
  row: { dimension?: string; dimension_value?: string },
  filter: DimensionFilter | undefined,
): boolean {
  const dim = row.dimension ?? "";
  const val = row.dimension_value ?? "";
  return filter ? dim === filter.dimension && val === filter.value : dim === "" && val === "";
}

/**
 * Index rows once so many metrics can be resolved against the same data.
 */
export class MetricResolver {
  private dailyByKey = new Map<string, DailyRow[]>();
  private periodByKey = new Map<string, PeriodRow[]>();

  constructor(data: MetricData) {
    for (const r of data.daily) push(this.dailyByKey, r.metric_key, r);
    for (const r of data.period) push(this.periodByKey, r.metric_key, r);
  }

  resolve(key: string, range: DateRange, filter?: DimensionFilter, depth = 0): ResolvedValue {
    if (depth > 8) throw new Error(`Metric definition cycle near ${key}`);
    const def = METRICS[key];
    if (!def) throw new Error(`Unknown metric key: ${key}`);
    const agg = def.aggregation;

    switch (agg.type) {
      case "sum":
        return this.sumAdditive(key, range, filter);

      case "average": {
        const rows = this.dailyInRange(key, range, filter);
        if (rows.length === 0) return NULL_VALUE;
        return { value: rows.reduce((s, r) => s + r.value, 0) / rows.length, estimated: false };
      }

      case "last": {
        // A period row (e.g. followers from a monthly export) counts as a
        // reading taken on its last day. Daily readings win ties.
        const points = [
          ...this.dailyInRange(key, range, filter).map((r) => ({ date: r.date, value: r.value, daily: 1 })),
          ...this.periodsFor(key, filter)
            .filter((p) => p.period_end >= range.start && p.period_end <= range.end)
            .map((p) => ({ date: p.period_end, value: p.value, daily: 0 })),
        ];
        if (points.length === 0) return NULL_VALUE;
        const latest = points.reduce((a, b) => (b.date > a.date || (b.date === a.date && b.daily > a.daily) ? b : a));
        return { value: latest.value, estimated: false };
      }

      case "unique": {
        const exact = this.periodsFor(key, filter).find((r) => r.period_start === range.start && r.period_end === range.end);
        if (exact) return { value: exact.value, estimated: false };
        const fallback = this.sumAdditive(key, range, filter);
        return fallback.value === null ? NULL_VALUE : { value: fallback.value, estimated: true };
      }

      case "ratio": {
        const num = this.resolve(agg.numerator, range, filter, depth + 1);
        const den = this.resolve(agg.denominator, range, filter, depth + 1);
        if (num.value === null || den.value === null || den.value === 0) return NULL_VALUE;
        return { value: num.value / den.value, estimated: num.estimated || den.estimated };
      }

      case "derived_sum": {
        let total: number | null = null;
        let estimated = false;
        for (const part of agg.of) {
          const r = this.resolve(part, range, filter, depth + 1);
          if (r.value === null) continue;
          total = (total ?? 0) + r.value;
          estimated ||= r.estimated;
        }
        return { value: total, estimated };
      }
    }
  }

  /** Values for one dimension (e.g. sessions by channel), largest first. */
  breakdown(key: string, dimension: string, range: DateRange): { bucket: string; value: number }[] {
    const buckets = new Set<string>();
    const def = METRICS[key];
    const keys = def?.aggregation.type === "ratio" ? [key, def.aggregation.numerator, def.aggregation.denominator] : [key];
    for (const k of keys) {
      for (const r of this.dailyByKey.get(k) ?? []) {
        if (r.dimension === dimension && r.date >= range.start && r.date <= range.end) buckets.add(r.dimension_value ?? "");
      }
      for (const r of this.periodByKey.get(k) ?? []) {
        if (r.dimension === dimension && r.period_start <= range.end && r.period_end >= range.start) {
          buckets.add(r.dimension_value ?? "");
        }
      }
    }
    return [...buckets]
      .map((bucket) => ({ bucket, value: this.resolve(key, range, { dimension, value: bucket }).value }))
      .filter((b): b is { bucket: string; value: number } => b.value !== null)
      .sort((a, b) => b.value - a.value);
  }

  /** True if any row exists for this metric in the range. */
  has(key: string, range: DateRange): boolean {
    return this.resolve(key, range).value !== null;
  }

  private dailyInRange(key: string, range: DateRange, filter?: DimensionFilter): DailyRow[] {
    return (this.dailyByKey.get(key) ?? []).filter(
      (r) => r.date >= range.start && r.date <= range.end && matchesDimension(r, filter),
    );
  }

  private periodsFor(key: string, filter?: DimensionFilter): PeriodRow[] {
    return (this.periodByKey.get(key) ?? []).filter((r) => matchesDimension(r, filter));
  }

  /**
   * Sum of an additive metric. Daily rows are used where they exist. Period
   * totals (from monthly exports with no daily breakdown) fill in where there
   * are no daily rows; a period that only partly overlaps the range is
   * prorated by day and flagged as an estimate.
   */
  private sumAdditive(key: string, range: DateRange, filter?: DimensionFilter): ResolvedValue {
    const allDaily = (this.dailyByKey.get(key) ?? []).filter((r) => matchesDimension(r, filter));
    const inRange = allDaily.filter((r) => r.date >= range.start && r.date <= range.end);
    let total: number | null = inRange.length ? inRange.reduce((s, r) => s + r.value, 0) : null;
    let estimated = false;

    // Overlapping periods would double count. Prefer an exact match, then
    // periods fully inside the range, then longer periods.
    const candidates = this.periodsFor(key, filter)
      .filter((p) => p.period_start <= range.end && p.period_end >= range.start)
      .sort((a, b) => periodRank(b, range) - periodRank(a, range));
    const accepted: PeriodRow[] = [];
    for (const p of candidates) {
      if (accepted.some((a) => a.period_start <= p.period_end && a.period_end >= p.period_start)) continue;
      if (allDaily.some((r) => r.date >= p.period_start && r.date <= p.period_end)) continue;
      accepted.push(p);
      const start = p.period_start > range.start ? p.period_start : range.start;
      const end = p.period_end < range.end ? p.period_end : range.end;
      const share = dayCount(start, end) / dayCount(p.period_start, p.period_end);
      if (share < 1) estimated = true;
      total = (total ?? 0) + p.value * share;
    }
    return total === null ? NULL_VALUE : { value: total, estimated };
  }
}

/**
 * Drop rows for metrics whose source is not turned on for the client. Combined
 * metrics (Total Audience Reach...) then only add up the client's channels.
 */
export function onlyEnabledSources(data: MetricData, enabled: ReadonlySet<string>): MetricData {
  const keep = (key: string) => {
    const source = METRICS[key]?.source;
    return source !== undefined && source !== "combined" && enabled.has(source);
  };
  return { daily: data.daily.filter((r) => keep(r.metric_key)), period: data.period.filter((r) => keep(r.metric_key)) };
}

function dayCount(start: ISODate, end: ISODate): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function periodRank(p: PeriodRow, range: DateRange): number {
  if (p.period_start === range.start && p.period_end === range.end) return 1e9;
  const inside = p.period_start >= range.start && p.period_end <= range.end;
  return (inside ? 1e6 : 0) + dayCount(p.period_start, p.period_end);
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export interface Comparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  /** Fractional change (0.039 = +3.9%). null when previous is 0 or missing. */
  pctChange: number | null;
  direction: "up" | "down" | "flat" | null;
  /** Whether the change is good news, per the metric's upIsGood. */
  sentiment: "positive" | "negative" | "neutral" | null;
}

export function compare(key: string, current: number | null, previous: number | null): Comparison {
  if (current === null || previous === null) {
    return { current, previous, delta: null, pctChange: null, direction: null, sentiment: null };
  }
  const delta = current - previous;
  const pctChange = previous === 0 ? null : delta / Math.abs(previous);
  const direction = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const upIsGood = METRICS[key]?.upIsGood ?? true;
  const sentiment =
    direction === "flat" ? "neutral" : (direction === "up") === upIsGood ? "positive" : "negative";
  return { current, previous, delta, pctChange, direction, sentiment };
}
