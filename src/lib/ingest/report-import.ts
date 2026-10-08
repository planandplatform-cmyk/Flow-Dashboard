/**
 * Importing a complete past report (one PDF covering website, social, ads):
 * Claude reads every section once, then each platform's numbers go through
 * the same review and save rules as a single-platform screenshot. One upload
 * is saved per platform, so each can be rolled back on its own.
 *
 * Pure module; the Claude call lives in screenshot-reader.ts.
 */
import { z } from "zod";
import { METRICS } from "@/lib/metrics/config";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import {
  COMPETITOR_METRICS,
  metricGuide,
  metricKeysFor,
  reviewExtraction,
  SCREENSHOT_BREAKDOWNS,
  SCREENSHOT_PLATFORMS,
  type BreakdownReviewItem,
  type CompetitorReviewItem,
  type Extraction,
  type ReviewedScreenshotData,
  type ReviewItem,
  type ScreenshotPlatform,
} from "./screenshot";
import type { BreakdownType, Period } from "./types";

/** Breakdown tables a report can contain, stored as metric rows by dimension. */
const TABLE_KEYS = ["ga4_sessions", "ga4_page_views", "ga4_users", "ga4_key_events"] as const;

export function reportPlatforms(enabled: readonly string[]): ScreenshotPlatform[] {
  return SCREENSHOT_PLATFORMS.filter((p) => enabled.includes(p));
}

export function reportSchema(platforms: ScreenshotPlatform[]) {
  const keys = [...new Set(platforms.flatMap(metricKeysFor))] as [string, ...string[]];
  const tableKeys = TABLE_KEYS.filter((k) => keys.includes(k));
  return z.object({
    is_report: z.boolean().describe("False if the file is not an analytics report."),
    date_range: z
      .object({
        start: z.string().describe("YYYY-MM-DD"),
        end: z.string().describe("YYYY-MM-DD"),
        label: z.string().describe("The reporting period exactly as printed"),
      })
      .nullable(),
    metrics: z.array(
      z.object({
        key: z.enum(keys),
        value: z.number().describe("The number shown, fully written out"),
        value_text: z.string().describe("The number exactly as printed"),
        label_seen: z.string().describe("The label printed next to the number"),
        page: z.number().describe("PDF page number it came from"),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    table_rows: z
      .array(
        z.object({
          key: z.enum((tableKeys.length ? tableKeys : ["ga4_sessions"]) as [string, ...string[]]),
          dimension: z.enum(["channel", "landing_page"]),
          bucket: z.string().describe("Channel name as printed, e.g. 'Organic Search', or for pages the path only, e.g. '/careers'"),
          value: z.number(),
          page: z.number(),
        }),
      )
      .describe(
        "Website tables only: sessions or users by channel (session default channel group), sessions or views by landing page or page path. Empty if none.",
      ),
    breakdowns: z.array(
      z.object({
        platform: z.enum(platforms as [ScreenshotPlatform, ...ScreenshotPlatform[]]),
        type: z.enum(SCREENSHOT_BREAKDOWNS as [BreakdownType, ...BreakdownType[]]),
        bucket: z.string(),
        percent: z.number().describe("Share in percent, 0 to 100, as printed"),
        page: z.number(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    competitors: z.array(
      z.object({
        company: z.string(),
        is_your_page: z.boolean(),
        metric: z.enum(COMPETITOR_METRICS),
        value: z.number(),
        value_text: z.string(),
        change_percent: z.number().nullable(),
        page: z.number(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    commentary: z
      .object({
        headline: z.string().nullable().describe("The report's key takeaway or headline"),
        summary: z.string().nullable().describe("The executive summary text, paragraphs separated by a blank line"),
        conclusion: z.string().nullable(),
      })
      .nullable()
      .describe("The report's own written summary, copied exactly. Null if none."),
    notes: z.array(z.string()),
  });
}

export type ReportExtraction = z.infer<ReturnType<typeof reportSchema>>;

export function reportGuide(platforms: ScreenshotPlatform[]): string {
  return platforms.map((p) => `${SOURCE_LABELS[p]} (${p}):\n${metricGuide(p)}`).join("\n\n");
}

export type ReportItem = ReviewItem & { source: ScreenshotPlatform };
export type ReportBreakdown = BreakdownReviewItem & { platform: ScreenshotPlatform };
export interface ReportTableRow {
  key: string;
  dimension: "channel" | "landing_page";
  bucket: string;
  value: number;
  page: number;
}

export interface ReportReview {
  period: Period | null;
  items: ReportItem[];
  tableRows: ReportTableRow[];
  breakdowns: ReportBreakdown[];
  competitors: CompetitorReviewItem[];
  commentary: { headline: string | null; summary: string | null; conclusion: string | null } | null;
  warnings: string[];
  errors: string[];
}

/** Review each platform's share with the single-platform rules, then merge. */
export function reviewReport(extraction: ReportExtraction, platforms: ScreenshotPlatform[], entered: Period | undefined): ReportReview {
  const warnings = new Set<string>();
  const errors = new Set<string>();
  if (!extraction.is_report) errors.add("This does not look like an analytics report.");
  let period: Period | null = null;
  const items: ReportItem[] = [];
  const breakdowns: ReportBreakdown[] = [];
  let competitors: CompetitorReviewItem[] = [];

  for (const p of platforms) {
    const sub: Extraction = {
      is_analytics_screenshot: true,
      platform_seen: "unclear",
      date_range: extraction.date_range,
      metrics: extraction.metrics
        .filter((m) => metricKeysFor(p).includes(m.key) && (METRICS[m.key]?.source === p || !METRICS[m.key]))
        .map((m) => ({ ...m, image_index: m.page })),
      breakdowns: extraction.breakdowns.filter((b) => b.platform === p).map((b) => ({ ...b, image_index: b.page })),
      competitors: p === "linkedin" ? extraction.competitors.map((c) => ({ ...c, image_index: c.page })) : [],
      campaign_name: null,
      notes: [],
    };
    const r = reviewExtraction(sub, p, entered);
    period ??= r.period;
    items.push(...r.items.map((i) => ({ ...i, source: p })));
    breakdowns.push(...r.breakdowns.map((b) => ({ ...b, platform: p })));
    if (p === "linkedin") competitors = r.competitors;
    r.warnings.forEach((w) => warnings.add(w));
    r.errors.forEach((e) => errors.add(e));
  }
  extraction.notes.forEach((n) => warnings.add(n));
  if (!items.length && !extraction.table_rows.length && !breakdowns.length && !competitors.length) errors.add("No numbers could be read from this report.");

  // Table rows the portal cannot store are left out with a note, never blocking the save.
  const storable = (t: ReportExtraction["table_rows"][number]) => (METRICS[t.key]?.dimensions ?? []).includes(t.dimension);
  const skipped = extraction.table_rows.filter((t) => !storable(t));
  if (skipped.length) {
    const tables = [...new Set(skipped.map((t) => `${METRICS[t.key]?.label ?? t.key} by ${t.dimension === "channel" ? "channel" : "page"}`))];
    warnings.add(`Left out ${skipped.length} table rows the portal does not store (${tables.join(", ")}).`);
  }

  return {
    period,
    items,
    tableRows: extraction.table_rows.filter(storable).map((t) => ({ key: t.key, dimension: t.dimension, bucket: t.bucket, value: t.value, page: t.page })),
    breakdowns,
    competitors,
    commentary: extraction.commentary,
    warnings: [...warnings],
    errors: [...errors],
  };
}

/** What the reviewer confirmed, split into one save per platform. */
export interface ReviewedReport {
  period: Period;
  metrics: { source: ScreenshotPlatform; key: string; value: number }[];
  tableRows: { key: string; dimension: string; bucket: string; value: number }[];
  breakdowns: { platform: ScreenshotPlatform; type: BreakdownType; bucket: string; percent: number }[];
  competitors: ReviewedScreenshotData["competitors"];
  commentary: { headline: string | null; summary: string | null; conclusion: string | null } | null;
}

export function splitReport(r: ReviewedReport): ReviewedScreenshotData[] {
  const sources = new Set<ScreenshotPlatform>([
    ...r.metrics.map((m) => m.source),
    ...r.breakdowns.map((b) => b.platform),
    ...(r.tableRows.length ? (["ga4"] as const) : []),
    ...(r.competitors?.length ? (["linkedin"] as const) : []),
  ]);
  return SCREENSHOT_PLATFORMS.filter((p) => sources.has(p)).map((p) => ({
    platform: p,
    period: r.period,
    campaignName: null,
    metrics: [
      ...r.metrics.filter((m) => m.source === p).map(({ key, value }) => ({ key, value })),
      ...(p === "ga4" ? r.tableRows.map((t) => ({ key: t.key, value: t.value, dimension: t.dimension, bucket: t.bucket })) : []),
    ],
    breakdowns: r.breakdowns.filter((b) => b.platform === p).map(({ type, bucket, percent }) => ({ type, bucket, percent })),
    competitors: p === "linkedin" ? r.competitors : undefined,
  }));
}
