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
        return this.sumDaily(key, range, filter);

      case "average": {
        const rows = this.dailyInRange(key, range, filter);
        if (rows.length === 0) return NULL_VALUE;
        return { value: rows.reduce((s, r) => s + r.value, 0) / rows.length, estimated: false };
      }

      case "last": {
        const rows = this.dailyInRange(key, range, filter);
        if (rows.length === 0) return NULL_VALUE;
        const latest = rows.reduce((a, b) => (b.date > a.date ? b : a));
        return { value: latest.value, estimated: false };
      }

      case "unique": {
        const exact = (this.periodByKey.get(key) ?? []).find(
          (r) => r.period_start === range.start && r.period_end === range.end && matchesDimension(r, filter),
        );
        if (exact) return { value: exact.value, estimated: false };
        const fallback = this.sumDaily(key, range, filter);
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
    for (const r of this.dailyByKey.get(key) ?? []) {
      if (r.dimension === dimension && r.date >= range.start && r.date <= range.end) buckets.add(r.dimension_value ?? "");
    }
    const def = METRICS[key];
    if (def?.aggregation.type === "ratio") {
      for (const k of [def.aggregation.numerator, def.aggregation.denominator]) {
        for (const r of this.dailyByKey.get(k) ?? []) {
          if (r.dimension === dimension && r.date >= range.start && r.date <= range.end) buckets.add(r.dimension_value ?? "");
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

  private sumDaily(key: string, range: DateRange, filter?: DimensionFilter): ResolvedValue {
    const rows = this.dailyInRange(key, range, filter);
    if (rows.length === 0) return NULL_VALUE;
    return { value: rows.reduce((s, r) => s + r.value, 0), estimated: false };
  }
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
