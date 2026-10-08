import { canBeNegative, METRICS } from "@/lib/metrics/config";
import type { DataSource } from "@/lib/metrics/types";
import type {
  AdDailyIn,
  CampaignIn,
  DailyIn,
  IngestBatch,
  MetricTotal,
  ParseResult,
  PeriodIn,
  PostIn,
  SnapshotIn,
} from "./types";

/**
 * Collects normalized rows from a parser, de-duplicates them, and validates
 * the result. Every parser writes through this so validation is uniform.
 */
export class BatchBuilder {
  private dailyMap = new Map<string, DailyIn>();
  private periodMap = new Map<string, PeriodIn>();
  private postMap = new Map<string, PostIn>();
  private snapshotMap = new Map<string, SnapshotIn>();
  private campaignMap = new Map<string, CampaignIn>();
  private adDailyMap = new Map<string, AdDailyIn>();
  private mapped = new Set<string>();
  private unmapped = new Set<string>();
  private warningSet = new Set<string>();
  private errorList: string[] = [];
  private duplicates = 0;
  rowsRead = 0;

  daily(source: DataSource, metric_key: string, date: string, value: number | null, dimension = "", dimension_value = "") {
    if (value === null) return;
    const k = [source, metric_key, date, dimension, dimension_value].join("|");
    if (this.dailyMap.has(k)) this.duplicates++;
    this.dailyMap.set(k, { source, metric_key, date, dimension, dimension_value, value });
  }

  period(
    source: DataSource,
    metric_key: string,
    period_start: string,
    period_end: string,
    value: number | null,
    dimension = "",
    dimension_value = "",
  ) {
    if (value === null) return;
    const k = [source, metric_key, period_start, period_end, dimension, dimension_value].join("|");
    if (this.periodMap.has(k)) this.duplicates++;
    this.periodMap.set(k, { source, metric_key, period_start, period_end, dimension, dimension_value, value });
  }

  /** Daily row when a date is known, otherwise a period total. */
  value(
    source: DataSource,
    metric_key: string,
    when: { date: string } | { start: string; end: string },
    value: number | null,
    dimension = "",
    dimension_value = "",
  ) {
    if ("date" in when) this.daily(source, metric_key, when.date, value, dimension, dimension_value);
    else this.period(source, metric_key, when.start, when.end, value, dimension, dimension_value);
  }

  post(p: PostIn) {
    const k = `${p.platform}|${p.external_id}`;
    if (this.postMap.has(k)) this.duplicates++;
    this.postMap.set(k, p);
  }

  snapshot(s: SnapshotIn) {
    const k = [s.platform, s.snapshot_date, s.breakdown_type, s.bucket].join("|");
    if (this.snapshotMap.has(k)) this.duplicates++;
    this.snapshotMap.set(k, s);
  }

  /** Campaigns seen more than once widen to cover every row's dates. */
  campaign(c: CampaignIn) {
    const prev = this.campaignMap.get(c.external_campaign_id);
    if (!prev) {
      this.campaignMap.set(c.external_campaign_id, c);
      return;
    }
    const min = (a: string | null, b: string | null) => (a && b ? (a < b ? a : b) : (a ?? b));
    const max = (a: string | null, b: string | null) => (a && b ? (a > b ? a : b) : (a ?? b));
    this.campaignMap.set(c.external_campaign_id, {
      ...prev,
      objective: prev.objective ?? c.objective,
      status: prev.status ?? c.status,
      start_date: min(prev.start_date, c.start_date),
      end_date: max(prev.end_date, c.end_date),
    });
  }

  /** Ad rows for the same campaign and day (ad set or ad level exports) add up. */
  adDaily(r: AdDailyIn) {
    const k = `${r.external_campaign_id}|${r.date}`;
    const prev = this.adDailyMap.get(k);
    if (!prev) {
      this.adDailyMap.set(k, { ...r });
      return;
    }
    prev.spend = Math.round((prev.spend + r.spend) * 100) / 100;
    prev.impressions += r.impressions;
    prev.reach += r.reach;
    prev.clicks += r.clicks;
    prev.leads += r.leads;
  }

  columns(mapped: string[], unmapped: string[]) {
    for (const c of mapped) if (c) this.mapped.add(c);
    for (const c of unmapped) if (c && !this.mapped.has(c)) this.unmapped.add(c);
  }

  warn(message: string) {
    this.warningSet.add(message);
  }

  error(message: string) {
    this.errorList.push(message);
  }

  get hasErrors() {
    return this.errorList.length > 0;
  }

  batch(): IngestBatch {
    return {
      daily: [...this.dailyMap.values()],
      period: [...this.periodMap.values()],
      posts: [...this.postMap.values()],
      snapshots: [...this.snapshotMap.values()],
      adCampaigns: [...this.campaignMap.values()],
      adDaily: [...this.adDailyMap.values()],
    };
  }

  finalize(parser: { id: string; label: string }): ParseResult {
    const batch = this.batch();
    const errors = [...this.errorList];
    const warnings = [...this.warningSet];

    // Metric keys and sources must match the metric config.
    const badKeys = new Set<string>();
    const negative = new Set<string>();
    for (const r of [...batch.daily, ...batch.period]) {
      const def = METRICS[r.metric_key];
      if (!def || def.source !== r.source) badKeys.add(`${r.source}:${r.metric_key}`);
      if (!Number.isFinite(r.value)) badKeys.add(`${r.metric_key} (not a number)`);
      if (r.value < 0 && !canBeNegative(r.metric_key)) negative.add(def?.label ?? r.metric_key);
    }
    if (badKeys.size) errors.push(`Internal mapping error, unknown metrics: ${[...badKeys].join(", ")}`);
    if (negative.size) errors.push(`Negative values found for: ${[...negative].join(", ")}. Check the file.`);
    for (const p of batch.period) {
      if (p.period_end < p.period_start) errors.push(`Period ends before it starts (${p.period_start} to ${p.period_end}).`);
    }
    for (const s of batch.snapshots) {
      if (!(s.share >= 0 && s.share <= 1)) errors.push(`Share out of range for ${s.breakdown_type} "${s.bucket}".`);
    }
    const shareSums = new Map<string, number>();
    for (const s of batch.snapshots) {
      const k = `${s.platform} ${s.breakdown_type}`;
      shareSums.set(k, (shareSums.get(k) ?? 0) + s.share);
    }
    for (const [k, total] of shareSums) {
      if (total > 1.02) warnings.push(`${k} shares add up to ${(total * 100).toFixed(1)}%, more than 100%.`);
    }

    const empty =
      batch.daily.length + batch.period.length + batch.posts.length + batch.snapshots.length + batch.adDaily.length === 0;
    if (empty && errors.length === 0) errors.push("No data rows were found in this file.");
    if (this.duplicates > 0) {
      warnings.push(`${this.duplicates} duplicate row${this.duplicates === 1 ? "" : "s"} in the file; the last one was kept.`);
    }

    // Overall date span.
    const dates: string[] = [];
    for (const r of batch.daily) dates.push(r.date);
    for (const r of batch.period) dates.push(r.period_start, r.period_end);
    for (const r of batch.adDaily) dates.push(r.date);
    for (const s of batch.snapshots) dates.push(s.period_start ?? s.snapshot_date, s.snapshot_date);
    for (const p of batch.posts) dates.push(p.published_at.slice(0, 10));
    dates.sort();

    const kinds = [
      batch.daily.length + batch.adDaily.length > 0 && "daily",
      batch.period.length > 0 && "period",
      batch.posts.length > 0 && "lifetime",
      batch.snapshots.length > 0 && "snapshot",
    ].filter(Boolean) as ParseResult["granularity"][];

    const sources = new Set<DataSource>();
    for (const r of [...batch.daily, ...batch.period]) sources.add(r.source);
    for (const p of batch.posts) sources.add(p.platform);
    for (const s of batch.snapshots) sources.add(s.platform);
    if (batch.adDaily.length || batch.adCampaigns.length) sources.add("meta_ads");

    return {
      ok: errors.length === 0,
      parserId: parser.id,
      parserLabel: parser.label,
      sources: [...sources],
      batch,
      periodStart: dates[0] ?? null,
      periodEnd: dates.at(-1) ?? null,
      granularity: kinds.length === 1 ? kinds[0] : kinds.length === 0 ? "period" : "mixed",
      rowsRead: this.rowsRead,
      mappedColumns: [...this.mapped],
      unmappedColumns: [...this.unmapped].filter((c) => !this.mapped.has(c)),
      duplicatesInFile: this.duplicates,
      totals: computeTotals(batch),
      warnings,
      errors,
    };
  }
}

/** File totals per metric (dimension totals only), for the preview screen. */
function computeTotals(batch: IngestBatch): MetricTotal[] {
  const acc = new Map<string, MetricTotal & { lastDate: string }>();
  const add = (source: DataSource, key: string, date: string, value: number) => {
    const def = METRICS[key];
    if (!def || def.aggregation.type === "ratio" || def.aggregation.type === "derived_sum") return;
    const k = `${source}|${key}`;
    const prev = acc.get(k);
    if (!prev) return void acc.set(k, { source, metric_key: key, value, lastDate: date });
    if (def.aggregation.type === "last") {
      if (date >= prev.lastDate) Object.assign(prev, { value, lastDate: date });
    } else prev.value += value;
  };
  for (const r of batch.daily) if (r.dimension === "") add(r.source, r.metric_key, r.date, r.value);
  for (const r of batch.period) if (r.dimension === "") add(r.source, r.metric_key, r.period_end, r.value);
  for (const r of batch.adDaily) {
    add("meta_ads", "ads_spend", r.date, r.spend);
    add("meta_ads", "ads_impressions", r.date, r.impressions);
    add("meta_ads", "ads_clicks", r.date, r.clicks);
    add("meta_ads", "ads_leads", r.date, r.leads);
  }
  return [...acc.values()]
    .map(({ source, metric_key, value }) => ({ source, metric_key, value: Math.round(value * 100) / 100 }))
    .sort((a, b) => a.metric_key.localeCompare(b.metric_key));
}
