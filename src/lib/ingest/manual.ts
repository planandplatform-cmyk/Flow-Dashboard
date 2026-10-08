/**
 * Manual entry: one-off values (e.g. total LinkedIn followers, account-level
 * ad reach) and audience breakdowns entered as percentages. Produces the same
 * batch shape as a file upload so it goes through the same commit and
 * rollback path.
 */
import { canBeNegative, METRICS } from "@/lib/metrics/config";
import { DATA_SOURCES, type DataSource } from "@/lib/metrics/types";
import { BatchBuilder } from "./batch";
import type { BreakdownType, IngestBatch } from "./types";

function readSource(value: FormDataEntryValue | null): DataSource | undefined {
  const s = String(value ?? "");
  return (DATA_SOURCES as readonly string[]).includes(s) ? (s as DataSource) : undefined;
}

export function readPeriod(form: FormData): { start: string; end: string } | undefined | "invalid" {
  const start = String(form.get("periodStart") ?? "");
  const end = String(form.get("periodEnd") ?? "");
  if (!start && !end) return undefined;
  const ok = /^\d{4}-\d{2}-\d{2}$/;
  if (!ok.test(start) || !ok.test(end) || end < start) return "invalid";
  return { start, end };
}

export const BREAKDOWNS: BreakdownType[] = [
  "age", "gender", "country", "city", "language", "discovery_surface", "follower_status", "follower_status_engagement",
  "format_engagement", "format_views", "job_function", "seniority", "industry", "company_size",
];

/** Build a batch from the manual entry form fields. */
export function buildManualBatch(form: FormData): { batch: IngestBatch; source: DataSource; period: { start: string; end: string } } | { error: string } {
  const mode = String(form.get("mode"));
  const period = readPeriod(form);
  if (!period || period === "invalid") return { error: "Enter a valid start and end date, with the end on or after the start." };
  const b = new BatchBuilder();

  if (mode === "metric") {
    const key = String(form.get("metric") ?? "");
    const def = METRICS[key];
    if (!def || def.source === "combined" || def.aggregation.type === "ratio" || def.aggregation.type === "derived_sum") {
      return { error: "Choose a metric. Rates like engagement rate are calculated automatically and cannot be entered." };
    }
    const raw = String(form.get("value") ?? "").replace(/[$,%\s]/g, "");
    let value = Number(raw);
    if (raw === "" || !Number.isFinite(value)) return { error: "Enter a number for the value." };
    if (value < 0 && !canBeNegative(key)) return { error: "This metric cannot be negative." };
    // Percentages are typed as shown (6.3 for 6.3%) and stored as fractions.
    if (def.format === "percent") value /= 100;
    const dimension = String(form.get("dimension") ?? "").trim();
    const dimensionValue = String(form.get("dimensionValue") ?? "").trim();
    if (Boolean(dimension) !== Boolean(dimensionValue)) return { error: "Fill in both the breakdown and its value, or neither." };
    if (dimension && !(def.dimensions ?? []).includes(dimension)) return { error: "That breakdown is not available for this metric." };
    // A single day is a daily value; a longer span is a period total. For
    // "last value" metrics like followers, a span is the count on its last day.
    if (period.start === period.end || def.aggregation.type === "last") {
      b.daily(def.source, key, period.end, value, dimension, dimensionValue);
    } else {
      b.period(def.source, key, period.start, period.end, value, dimension, dimensionValue);
    }
    return { batch: b.batch(), source: def.source, period };
  }

  if (mode === "breakdown") {
    const platform = readSource(form.get("platform"));
    const type = String(form.get("breakdownType")) as BreakdownType;
    if (!platform) return { error: "Choose a platform." };
    if (!BREAKDOWNS.includes(type)) return { error: "Choose a breakdown type." };
    const buckets = form.getAll("bucket").map((v) => String(v).trim());
    const shares = form.getAll("share").map((v) => String(v).replace("%", "").trim());
    let total = 0;
    const seen = new Set<string>();
    for (let i = 0; i < buckets.length; i++) {
      // Rows start with suggested labels, so a blank percentage means "skip".
      if (!shares[i]) continue;
      const pct = Number(shares[i]);
      if (!buckets[i] || !Number.isFinite(pct) || pct < 0 || pct > 100) {
        return { error: `Row ${i + 1}: enter a label and a percentage between 0 and 100.` };
      }
      if (seen.has(buckets[i].toLowerCase())) return { error: `"${buckets[i]}" is listed twice.` };
      seen.add(buckets[i].toLowerCase());
      total += pct;
      // Discovery and format mixes describe a period; demographics are a point in time.
      const periodBased = ["discovery_surface", "follower_status", "follower_status_engagement", "format_engagement", "format_views"].includes(type);
      b.snapshot({
        platform,
        snapshot_date: period.end,
        period_start: periodBased ? period.start : null,
        breakdown_type: type,
        bucket: buckets[i],
        share: pct / 100,
      });
    }
    if (seen.size === 0) return { error: "Add at least one row." };
    if (total > 100.5) return { error: `The percentages add up to ${total.toFixed(1)}%, more than 100%.` };
    return { batch: b.batch(), source: platform, period };
  }

  return { error: "Unknown entry type." };
}

