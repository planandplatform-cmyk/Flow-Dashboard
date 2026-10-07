/**
 * Screenshot ingestion: what Claude should look for on each platform's
 * analytics screens, the shape of its answer, and how a reviewed answer
 * becomes the same batch every other upload produces.
 *
 * Pure module (no API calls), so the rules are unit tested. The Claude call
 * lives in screenshot-reader.ts.
 */
import { z } from "zod";
import { METRICS } from "@/lib/metrics/config";
import type { DataSource } from "@/lib/metrics/types";
import { BatchBuilder } from "./batch";
import { num, parseDate } from "./cells";
import type { BreakdownType, ParseResult, Period } from "./types";

export const SCREENSHOT_PLATFORMS = ["ga4", "meta_facebook", "meta_instagram", "meta_ads", "linkedin"] as const;
export type ScreenshotPlatform = (typeof SCREENSHOT_PLATFORMS)[number];

export const MAX_SCREENSHOTS = 5;
export const MAX_SCREENSHOT_BYTES = 3_500_000; // per file (images after browser downscaling)
export const MAX_SCREENSHOTS_TOTAL_BYTES = 4_000_000; // request body limit with headroom
export const SCREENSHOT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"] as const;

/**
 * Metrics Claude may report per platform, with the labels each platform
 * shows on screen. LinkedIn shows interactions as separate counts, so those
 * come back as components and are added up here (never by the model).
 */
const LABELS: Record<ScreenshotPlatform, Record<string, string[]>> = {
  ga4: {
    ga4_sessions: ["Sessions"],
    ga4_engaged_sessions: ["Engaged sessions"],
    ga4_key_events: ["Key events", "Conversions (older reports)"],
    ga4_users: ["Total users", "Users", "Active users (only if total users is not shown)"],
    ga4_page_views: ["Views", "Page views", "Screen page views"],
  },
  meta_facebook: {
    fb_views: ["Views", "Impressions (older screens)"],
    fb_reach: ["Reach", "Viewers", "Accounts reached"],
    fb_interactions: ["Content interactions", "Interactions", "Engagements", "Post engagements"],
    fb_reactions: ["Reactions"],
    fb_page_visits: ["Facebook visits", "Page visits", "Visits"],
    fb_net_new_followers: ["Net follows", "Follows minus unfollows", "Follows (only if no net figure is shown)"],
    fb_followers: ["Followers", "Total followers", "Page followers"],
    fb_reels_views: ["Reels views", "Reels plays"],
    fb_reels_interactions: ["Reels interactions", "Reels engagement"],
  },
  meta_instagram: {
    ig_views: ["Views", "Impressions (older screens)"],
    ig_reach: ["Accounts reached", "Reach"],
    ig_interactions: ["Interactions", "Content interactions", "Accounts engaged is NOT this"],
    ig_profile_visits: ["Profile visits", "Profile activity: visits"],
    ig_net_new_followers: ["Net followers", "Follows minus unfollows", "Follows (only if no net figure is shown)"],
    ig_followers: ["Followers", "Total followers"],
    ig_reels_views: ["Reels views", "Views from Reels"],
    ig_reels_interactions: ["Reels interactions"],
    ig_post_views: ["Post views", "Views from posts"],
  },
  meta_ads: {
    ads_spend: ["Amount spent"],
    ads_reach: ["Reach"],
    ads_impressions: ["Impressions"],
    ads_clicks: ["Link clicks", "Clicks (all) if no link clicks are shown"],
    ads_leads: ["Leads", "Results (only when the result type is leads)"],
  },
  linkedin: {
    li_impressions: ["Impressions"],
    li_followers: ["Total followers", "Followers"],
    li_net_new_followers: ["New followers"],
    li_page_views: ["Page views", "Total page views"],
    li_reactions: ["Reactions"],
    li_comments: ["Comments"],
    li_reposts: ["Reposts", "Shares"],
    li_clicks: ["Clicks"],
  },
};

const LINKEDIN_COMPONENTS = ["li_reactions", "li_comments", "li_reposts", "li_clicks"];

export const SCREENSHOT_BREAKDOWNS: BreakdownType[] = [
  "age", "gender", "country", "city", "language", "discovery_surface", "follower_status",
  "follower_status_engagement", "format_engagement", "job_function", "seniority", "industry", "company_size",
];
const PERIOD_BREAKDOWNS = new Set<BreakdownType>(["discovery_surface", "follower_status", "follower_status_engagement", "format_engagement"]);

export function metricKeysFor(platform: ScreenshotPlatform): string[] {
  return Object.keys(LABELS[platform]);
}

export function labelFor(key: string): string {
  if (LINKEDIN_COMPONENTS.includes(key)) return key.replace("li_", "").replace(/^\w/, (c) => c.toUpperCase());
  return METRICS[key]?.label ?? key;
}

/** Plain-text guide for the prompt: one line per metric. */
export function metricGuide(platform: ScreenshotPlatform): string {
  return Object.entries(LABELS[platform])
    .map(([key, labels]) => `- ${key}: ${labels.join(" / ")}${METRICS[key] ? ` (${METRICS[key].definition})` : ""}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// The model's answer
// ---------------------------------------------------------------------------

export function extractionSchema(platform: ScreenshotPlatform) {
  const keys = metricKeysFor(platform) as [string, ...string[]];
  return z.object({
    is_analytics_screenshot: z.boolean().describe("False if no screenshot or PDF page is an analytics report for this platform."),
    platform_seen: z.enum(["google_analytics", "facebook", "instagram", "meta_ads", "linkedin", "other", "unclear"]),
    date_range: z
      .object({
        start: z.string().describe("YYYY-MM-DD"),
        end: z.string().describe("YYYY-MM-DD"),
        label: z.string().describe("The date text exactly as shown, e.g. 'Jul 1 - Jul 31, 2026' or 'Last 28 days'"),
      })
      .nullable()
      .describe("Null when no concrete dates are visible."),
    metrics: z.array(
      z.object({
        key: z.enum(keys),
        value: z.number().describe("The number shown, fully written out (21.2K becomes 21200)."),
        value_text: z.string().describe("The number exactly as printed on screen, e.g. '21,239' or '21.2K' or '$719.19'"),
        label_seen: z.string().describe("The label printed next to the number"),
        image_index: z.number().describe("1-based position of the screenshot or PDF it came from"),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    breakdowns: z.array(
      z.object({
        type: z.enum(SCREENSHOT_BREAKDOWNS as [BreakdownType, ...BreakdownType[]]),
        bucket: z.string().describe("Category label as shown, e.g. '25-34', 'Women', 'United States', 'Reels'"),
        percent: z.number().describe("Share in percent, 0 to 100, as shown"),
        image_index: z.number(),
        confidence: z.enum(["high", "medium", "low"]),
      }),
    ),
    campaign_name: z.string().nullable().describe("Meta Ads only: the campaign name when the screen shows a single campaign."),
    notes: z.array(z.string()).describe("Anything a reviewer should know: unreadable areas, partial screens, comparison periods ignored."),
  });
}

export type Extraction = z.infer<ReturnType<typeof extractionSchema>>;

// ---------------------------------------------------------------------------
// Reviewed values -> batch
// ---------------------------------------------------------------------------

/** What the reviewer confirms on screen; also what the commit action receives. */
export interface ReviewedScreenshotData {
  platform: ScreenshotPlatform;
  period: Period;
  campaignName: string | null;
  metrics: { key: string; value: number }[];
  breakdowns: { type: BreakdownType; bucket: string; percent: number }[];
}

export interface ReviewItem {
  key: string;
  label: string;
  value: number;
  valueText: string;
  labelSeen: string;
  imageIndex: number;
  confidence: "high" | "medium" | "low";
  note: string | null;
}

export interface BreakdownReviewItem {
  type: BreakdownType;
  bucket: string;
  percent: number;
  imageIndex: number;
  confidence: "high" | "medium" | "low";
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate reviewed values and build the batch. Used by the preview (on the
 * model's reading) and again on save (on what the reviewer confirmed), so
 * nothing reaches the database without passing the same rules.
 */
export function buildScreenshotResult(data: ReviewedScreenshotData): ParseResult {
  const b = new BatchBuilder();
  const parser = { id: "screenshot", label: "Screenshot read by AI" };
  const { platform, period } = data;

  if (!SCREENSHOT_PLATFORMS.includes(platform)) {
    b.error("Choose Google Analytics, Facebook, Instagram, Meta Ads or LinkedIn.");
    return b.finalize(parser);
  }
  if (!ISO.test(period.start) || !ISO.test(period.end) || period.end < period.start) {
    b.error("Enter the date range the numbers cover (start and end date).");
    return b.finalize(parser);
  }

  const allowed = new Set(metricKeysFor(platform));
  const values = new Map<string, number>();
  for (const m of data.metrics) {
    if (!allowed.has(m.key)) {
      b.error(`"${m.key}" is not a ${platform} metric.`);
      continue;
    }
    if (!Number.isFinite(m.value)) {
      b.error(`${labelFor(m.key)}: enter a number.`);
      continue;
    }
    if (m.value < 0 && !m.key.endsWith("_net_new_followers")) {
      b.error(`${labelFor(m.key)} cannot be negative.`);
      continue;
    }
    if (values.has(m.key) && values.get(m.key) !== m.value) {
      b.error(`${labelFor(m.key)} appears twice with different values. Keep only one.`);
      continue;
    }
    values.set(m.key, m.value);
  }

  // LinkedIn interactions = clicks + reactions + comments + reposts.
  const components = LINKEDIN_COMPONENTS.filter((k) => values.has(k));
  for (const k of components) values.delete(k);
  if (components.length) {
    const sum = components.reduce((s, k) => s + (data.metrics.find((m) => m.key === k)?.value ?? 0), 0);
    values.set("li_interactions", sum);
    if (components.length < LINKEDIN_COMPONENTS.length) {
      const missing = LINKEDIN_COMPONENTS.filter((k) => !components.includes(k)).map(labelFor);
      b.warn(`LinkedIn interactions only include what was on screen; missing: ${missing.join(", ")}.`);
    }
  }

  const source: DataSource = platform;
  let campaignId: string | null = null;
  if (platform === "meta_ads" && values.size) {
    const name = data.campaignName?.trim() || "Meta Ads (from screenshot)";
    campaignId = `name:${slug(name)}`;
    b.campaign({ source: "meta_ads", external_campaign_id: campaignId, name, objective: null, status: null, start_date: period.start, end_date: period.end });
  }

  for (const [key, value] of values) {
    const def = METRICS[key];
    // Follower counts are a reading on the last day; everything else is a total for the range.
    if (def.aggregation.type === "last") b.daily(source, key, period.end, value);
    else {
      b.period(source, key, period.start, period.end, value);
      if (campaignId) b.period(source, key, period.start, period.end, value, "campaign", campaignId);
    }
    b.rowsRead++;
  }

  if (data.breakdowns.length) {
    if (platform === "meta_ads") {
      b.warn("Audience breakdowns from ad screenshots are not stored; enter organic audience data on Facebook or Instagram.");
    } else {
      const seen = new Set<string>();
      for (const br of data.breakdowns) {
        const bucket = br.bucket.trim();
        const k = `${br.type}|${bucket.toLowerCase()}`;
        if (!bucket || seen.has(k)) continue;
        seen.add(k);
        if (!(br.percent >= 0 && br.percent <= 100)) {
          b.error(`${bucket}: the percentage must be between 0 and 100.`);
          continue;
        }
        b.snapshot({
          platform: source,
          snapshot_date: period.end,
          period_start: PERIOD_BREAKDOWNS.has(br.type) ? period.start : null,
          breakdown_type: br.type,
          bucket,
          share: br.percent / 100,
        });
        b.rowsRead++;
      }
    }
  }

  return b.finalize(parser);
}

/**
 * Turn the model's reading into review items plus warnings. The value shown
 * on screen is re-parsed independently; abbreviated numbers (21.2K) are
 * flagged because the exact figure is not visible.
 */
export function reviewExtraction(
  extraction: Extraction,
  platform: ScreenshotPlatform,
  entered: Period | undefined,
): {
  period: Period | null;
  items: ReviewItem[];
  breakdowns: BreakdownReviewItem[];
  campaignName: string | null;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!extraction.is_analytics_screenshot) {
    errors.push("These do not look like analytics reports for the chosen platform.");
  }
  const expected = { ga4: "google_analytics", meta_facebook: "facebook", meta_instagram: "instagram", meta_ads: "meta_ads", linkedin: "linkedin" }[platform];
  if (extraction.platform_seen !== expected && extraction.platform_seen !== "unclear") {
    warnings.push(`These look like ${extraction.platform_seen.replace("_", " ")}, not the platform you chose. Check before saving.`);
  }

  let period: Period | null = null;
  const seen = extraction.date_range;
  const seenStart = parseDate(seen?.start);
  const seenEnd = parseDate(seen?.end);
  if (seenStart && seenEnd && seenEnd >= seenStart) {
    period = { start: seenStart, end: seenEnd };
    if (entered && (entered.start !== seenStart || entered.end !== seenEnd)) {
      warnings.push(`The files show "${seen!.label}"; that range was used instead of the dates you entered.`);
    }
  } else if (entered) {
    period = entered;
    if (seen?.label) warnings.push(`The files show "${seen.label}" without exact dates; using the dates you entered.`);
  } else {
    errors.push(
      seen?.label
        ? `The files show "${seen.label}" but not exact dates. Enter the start and end date and read them again, or set the dates below.`
        : "No dates are visible in the files. Enter the start and end date below.",
    );
  }

  const items: ReviewItem[] = extraction.metrics.map((m) => {
    const abbreviated = /\d\s*[km]\b/i.test(m.value_text);
    const shown = abbreviated ? null : num(m.value_text);
    let value = m.value;
    let note: string | null = null;
    if (abbreviated) note = `Shown rounded as ${m.value_text}. Use the exact number from the platform if you have it.`;
    else if (shown !== null && Math.abs(shown - m.value) > Math.max(0.01, Math.abs(shown) * 0.001)) {
      value = shown;
      note = `Read as ${m.value}, but the screen shows ${m.value_text}; using ${shown}.`;
    }
    return {
      key: m.key,
      label: labelFor(m.key),
      value,
      valueText: m.value_text,
      labelSeen: m.label_seen,
      imageIndex: m.image_index,
      confidence: abbreviated && m.confidence === "high" ? "medium" : m.confidence,
      note,
    };
  });

  const low = items.filter((i) => i.confidence === "low").map((i) => i.label);
  if (low.length) warnings.push(`Low confidence readings: ${low.join(", ")}. Check them against the original.`);
  if (items.some((i) => /rounded/.test(i.note ?? ""))) warnings.push("Some numbers are rounded on screen (K or M). Replace them with exact figures where you can.");
  for (const n of extraction.notes) warnings.push(n);

  return {
    period,
    items,
    breakdowns: extraction.breakdowns.map((b) => ({ type: b.type, bucket: b.bucket, percent: b.percent, imageIndex: b.image_index, confidence: b.confidence })),
    campaignName: extraction.campaign_name,
    warnings,
    errors,
  };
}
