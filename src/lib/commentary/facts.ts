/**
 * The numbers an AI commentary draft is written from: one month against the
 * month before, for the client's channels only. Pure, so the exact facts the
 * model sees are unit tested.
 */
import { formatMonth, formatRange, daysBetween, addDays } from "@/lib/dates";
import { compare, type DateRange, type MetricResolver } from "@/lib/metrics/aggregate";
import { METRICS } from "@/lib/metrics/config";
import { formatDelta, formatMetric, formatPctChange } from "@/lib/metrics/format";
import { SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";

export interface FactMetric {
  key: string;
  label: string;
  value: string;
  previous: string | null;
  /** "+12.4% (+1,203)" */
  change: string | null;
  /** Good news, bad news, or neither, per the metric's own rule. */
  sentiment: "positive" | "negative" | "neutral" | null;
}

export interface FactSection {
  id: DataSource | "combined";
  label: string;
  /** For ads: the campaign window, which can run past month end. */
  window: string;
  metrics: FactMetric[];
  details: string[];
}

export interface MonthFacts {
  clientName: string;
  market: string | null;
  month: string;
  monthLabel: string;
  previousLabel: string;
  sections: FactSection[];
  topPosts: string[];
  audience: string[];
  events: string[];
}

export interface FactsInput {
  clientName: string;
  market: string | null;
  month: string;
  range: DateRange;
  previous: DateRange;
  enabled: DataSource[];
  resolver: MetricResolver;
  ads?: { range: DateRange; campaigns: string[] } | null;
  posts?: { platform: DataSource; format: string; summary: string | null; views: number | null }[];
  snapshots?: { platform: DataSource; breakdown_type: string; bucket: string; share: number }[];
  annotations?: { date: string; label: string }[];
}

const COMBINED = ["total_audience_reach", "total_interactions", "total_followers", "total_net_new_followers"];

function metric(resolver: MetricResolver, key: string, range: DateRange, previous: DateRange | null): FactMetric | null {
  const current = resolver.resolve(key, range).value;
  if (current === null) return null;
  const prev = previous ? resolver.resolve(key, previous).value : null;
  const c = compare(key, current, prev);
  return {
    key,
    label: METRICS[key].label,
    value: formatMetric(key, current),
    previous: prev === null ? null : formatMetric(key, prev),
    change: c.direction === null ? null : `${formatPctChange(c.pctChange)} (${formatDelta(key, c.delta)})`,
    sentiment: c.sentiment,
  };
}

const keysFor = (source: DataSource) =>
  Object.values(METRICS)
    .filter((m) => m.source === source)
    .map((m) => m.key);

export function buildMonthFacts(input: FactsInput): MonthFacts {
  const { resolver, range, previous } = input;
  const sections: FactSection[] = [];

  const socialCount = input.enabled.filter((s) => ["meta_facebook", "meta_instagram", "tiktok", "linkedin"].includes(s)).length;
  if (socialCount > 1) {
    const metrics = COMBINED.map((k) => metric(resolver, k, range, previous)).filter((m): m is FactMetric => m !== null);
    if (metrics.length) sections.push({ id: "combined", label: "All social channels combined", window: formatMonth(range.start), metrics, details: [] });
  }

  for (const source of input.enabled) {
    const isAds = source === "meta_ads";
    if (isAds && !input.ads) continue;
    const window = isAds ? input.ads!.range : range;
    // Ads compare with the same number of days just before the campaign window.
    const before = isAds ? { start: addDays(window.start, -daysBetween(window)), end: addDays(window.start, -1) } : previous;
    const metrics = keysFor(source)
      .map((k) => metric(resolver, k, window, before))
      .filter((m): m is FactMetric => m !== null);
    if (!metrics.length) continue;

    const details: string[] = [];
    if (isAds && input.ads!.campaigns.length) details.push(`Campaigns: ${input.ads!.campaigns.join(", ")}`);
    if (source === "ga4") {
      const channels = resolver.breakdown("ga4_sessions", "channel", range).slice(0, 5);
      if (channels.length) details.push(`Sessions by channel: ${channels.map((c) => `${c.bucket} ${formatMetric("ga4_sessions", c.value)}`).join(", ")}`);
      const pages = resolver.breakdown("ga4_page_views", "landing_page", range).slice(0, 5);
      if (pages.length) details.push(`Top landing pages by views: ${pages.map((p) => `${p.bucket} ${formatMetric("ga4_page_views", p.value)}`).join(", ")}`);
    }
    sections.push({
      id: source,
      label: isAds ? "Meta Ads (paid)" : `${SOURCE_LABELS[source]}${source === "ga4" || source === "shopify" ? "" : " (organic)"}`,
      window: isAds ? formatRange(window) : formatMonth(range.start),
      metrics,
      details,
    });
  }

  const enabled = new Set(input.enabled);
  const topPosts = (input.posts ?? [])
    .filter((p) => enabled.has(p.platform))
    .slice(0, 5)
    .map((p) => `${SOURCE_LABELS[p.platform]} ${p.format}: "${(p.summary ?? "").slice(0, 120)}" ${formatMetric("ig_views", p.views)} views`);

  const groups = new Map<string, string[]>();
  for (const s of input.snapshots ?? []) {
    if (!enabled.has(s.platform)) continue;
    const k = `${SOURCE_LABELS[s.platform]} ${s.breakdown_type.replace(/_/g, " ")}`;
    groups.set(k, [...(groups.get(k) ?? []), `${s.bucket} ${(s.share * 100).toFixed(1)}%`]);
  }
  const audience = [...groups].map(([k, v]) => `${k}: ${v.slice(0, 6).join(", ")}`);

  return {
    clientName: input.clientName,
    market: input.market,
    month: input.month,
    monthLabel: formatMonth(range.start),
    previousLabel: formatMonth(previous.start),
    sections,
    topPosts,
    audience,
    events: (input.annotations ?? []).map((a) => `${a.date}: ${a.label}`),
  };
}

/** Plain-text fact sheet for the prompt. */
export function factsToText(f: MonthFacts): string {
  const lines = [
    `Client: ${f.clientName}${f.market ? ` (market: ${f.market})` : ""}`,
    `Reporting month: ${f.monthLabel}. Comparison: ${f.previousLabel}.`,
    "",
  ];
  for (const s of f.sections) {
    lines.push(`## ${s.label} [section id: ${s.id}] (${s.window})`);
    for (const m of s.metrics) {
      const cmp = m.previous === null ? "no comparable prior value" : `prior ${m.previous}, change ${m.change}${m.sentiment ? `, ${m.sentiment}` : ""}`;
      lines.push(`- ${m.label}: ${m.value} (${cmp})`);
    }
    for (const d of s.details) lines.push(`- ${d}`);
    lines.push("");
  }
  if (f.topPosts.length) lines.push("## Top posts", ...f.topPosts.map((p) => `- ${p}`), "");
  if (f.audience.length) lines.push("## Audience and discovery shares", ...f.audience.map((a) => `- ${a}`), "");
  if (f.events.length) lines.push("## Events logged by Flow Forward Media", ...f.events.map((e) => `- ${e}`), "");
  return lines.join("\n").trim();
}
