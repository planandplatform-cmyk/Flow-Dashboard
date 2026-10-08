/**
 * Monthly trend series for the report's charts. Pure: the page fetches the
 * rows, this rolls them up month by month with each metric's own rules.
 */
import { addMonths, formatMonth, formatMonthShort, monthRange, monthsBetween } from "@/lib/dates";
import { METRICS } from "@/lib/metrics/config";
import type { DateRange, ISODate, MetricResolver } from "@/lib/metrics/aggregate";
import type { DataSource } from "@/lib/metrics/types";

/** Every stored metric a set of metrics is computed from, including themselves. */
export function metricDependencies(keys: string[]): string[] {
  const out = new Set<string>();
  const visit = (key: string) => {
    if (out.has(key) || !METRICS[key]) return;
    out.add(key);
    const agg = METRICS[key].aggregation;
    if (agg.type === "ratio") [agg.numerator, agg.denominator].forEach(visit);
    if (agg.type === "derived_sum") agg.of.forEach(visit);
  };
  keys.forEach(visit);
  return [...out];
}

/** Candidate metrics for trend charts, in display order. Only ones with data are shown. */
export const TREND_KEYS = [
  "total_audience_reach",
  "total_interactions",
  "total_followers",
  "ga4_sessions",
  "ga4_engagement_rate",
  "ga4_key_events",
  "ga4_avg_engagement_time",
  "ga4_revenue",
  "gsc_clicks",
  "gsc_position",
  "fb_views",
  "fb_interactions",
  "fb_followers",
  "ig_views",
  "ig_interactions",
  "ig_followers",
  "tt_views",
  "tt_followers",
  "li_impressions",
  "li_followers",
  "ads_leads",
  "ads_spend",
  "ads_cpl",
  "gads_conversions",
  "gads_spend",
  "gads_cpa",
  "shop_total_sales",
  "shop_orders",
];

export interface TrendPoint {
  month: string;
  /** "Jul '26" */
  label: string;
  /** "July 2026" */
  fullLabel: string;
  value: number | null;
  /** Same month a year earlier. */
  previous: number | null;
  /** The month is not over yet. */
  partial: boolean;
  estimated: boolean;
}

export interface TrendSeries {
  key: string;
  label: string;
  source: DataSource | "combined";
  format: (typeof METRICS)[string]["format"];
  upIsGood: boolean;
  points: TrendPoint[];
}

/** The months a trend covers: 12 by default, ending with the month the range ends in. */
export function trendMonths(range: DateRange, count = 12): string[] {
  const last = `${range.end.slice(0, 7)}-01`;
  const span = monthsBetween(range.start, range.end).length;
  return monthsBetween(addMonths(last, -(Math.min(Math.max(count, span), 24) - 1)), last);
}

/** The window to fetch for trends: the months plus the same months a year earlier. */
export function trendFetchRange(months: string[]): DateRange {
  return { start: addMonths(months[0], -12), end: monthRange(months.at(-1)!).end };
}

export function buildTrends(
  resolver: MetricResolver,
  keys: string[],
  months: string[],
  today: ISODate,
  label: (key: string) => string = (k) => METRICS[k].label,
): TrendSeries[] {
  return keys
    .map((key) => {
      const def = METRICS[key];
      const points = months.map((month) => {
        const r = monthRange(month);
        const current = resolver.resolve(key, r);
        const prior = resolver.resolve(key, monthRange(addMonths(month, -12)));
        return {
          month,
          label: formatMonthShort(month),
          fullLabel: formatMonth(month),
          value: current.value,
          previous: prior.value,
          partial: r.end >= today,
          estimated: current.estimated,
        };
      });
      return { key, label: label(key), source: def.source, format: def.format, upIsGood: def.upIsGood, points };
    })
    .filter((s) => s.points.filter((p) => p.value !== null).length >= 2);
}

/** One line per platform plus their total, month by month, for one kind of measure. */
export interface GrowthMetric {
  id: "followers" | "netNew" | "views" | "interactions";
  label: string;
  format: (typeof METRICS)[string]["format"];
  lines: { source: DataSource; label: string; key: string; inTotal: boolean }[];
  note: string | null;
  points: ({ month: string; label: string; fullLabel: string; partial: boolean; total: number | null } & Record<string, number | null | string | boolean>)[];
}

const GROWTH: { id: GrowthMetric["id"]; label: string }[] = [
  { id: "followers", label: "Audience" },
  { id: "netNew", label: "Net new followers" },
  { id: "views", label: "Views and impressions" },
  { id: "interactions", label: "Interactions" },
];

/**
 * Combined social growth: for each measure, every platform's monthly value
 * and the total. LinkedIn impressions are a different measure from views, so
 * they are drawn but not added into the views total (as in Social Media Reach).
 */
export function buildSocialGrowth(
  resolver: MetricResolver,
  platforms: { source: DataSource; label: string; keys: Record<GrowthMetric["id"], string> }[],
  months: string[],
  today: ISODate,
): GrowthMetric[] {
  return GROWTH.map(({ id, label }) => {
    const lines = platforms.map((p) => ({ source: p.source, label: p.label, key: p.keys[id], inTotal: !(id === "views" && p.source === "linkedin") }));
    const points = months.map((month) => {
      const r = monthRange(month);
      const row: GrowthMetric["points"][number] = { month, label: formatMonthShort(month), fullLabel: formatMonth(month), partial: r.end >= today, total: null };
      let total: number | null = null;
      for (const line of lines) {
        const v = resolver.resolve(line.key, r).value;
        row[line.source] = v;
        if (v !== null && line.inTotal) total = (total ?? 0) + v;
      }
      row.total = total;
      return row;
    });
    const withData = lines.filter((l) => points.filter((p) => p[l.source] !== null).length >= 2);
    const excluded = withData.some((l) => !l.inTotal);
    return {
      id,
      label,
      format: METRICS[lines[0]?.key]?.format ?? "number",
      lines: withData,
      note: excluded ? "LinkedIn reports impressions, a different measure from views, so it is shown but not added into the total." : null,
      points,
    };
  }).filter((g) => g.lines.length > 0);
}
