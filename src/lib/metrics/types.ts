export const DATA_SOURCES = [
  "ga4",
  "meta_facebook",
  "meta_instagram",
  "meta_ads",
  "google_ads",
  "search_console",
  "shopify",
  "tiktok",
  "linkedin",
] as const;

export type DataSource = (typeof DATA_SOURCES)[number];

export const SOURCE_LABELS: Record<DataSource, string> = {
  ga4: "Website",
  meta_facebook: "Facebook",
  meta_instagram: "Instagram",
  meta_ads: "Meta Ads",
  shopify: "Shopify",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
  google_ads: "Google Ads",
  search_console: "Google Search",
};

export const SOCIAL_SOURCES = ["meta_facebook", "meta_instagram", "tiktok", "linkedin"] as const;
export type SocialSource = (typeof SOCIAL_SOURCES)[number];

/**
 * How a metric's value is presented.
 * - number:     1,234
 * - percent:    stored as a fraction (0.986), shown as 98.6%
 * - currency:   USD, $719.19
 * - multiplier: 2.19x (frequency)
 * - duration:   stored in minutes, shown as 4h 58m (watch time)
 */
export type MetricFormat = "number" | "percent" | "currency" | "multiplier" | "duration";

/**
 * How a metric rolls up over an arbitrary date range.
 *
 * - sum:         add daily values (views, sessions, spend).
 * - last:        the most recent daily value in the range (follower counts).
 * - average:     mean of daily values. Only for metrics that are genuinely
 *                averages of a daily state. Never use for ratios.
 * - unique:      de-duplicated counts like reach. Not additive across days, so
 *                the exact value only exists for periods the platform reported
 *                (metrics_period). Other ranges fall back to the daily sum and
 *                are flagged as estimates.
 * - ratio:       numerator / denominator, each resolved for the range first.
 *                Engagement rate, CTR, CPL and frequency are always recomputed
 *                this way, never averaged from daily values.
 * - derived_sum: sum of other metrics (possibly across sources), e.g. Total
 *                Audience Reach = Facebook views + Instagram views.
 */
export type Aggregation =
  | { type: "sum" }
  | { type: "last" }
  | { type: "average" }
  | { type: "unique" }
  | { type: "ratio"; numerator: string; denominator: string }
  | { type: "derived_sum"; of: string[] };

export interface MetricDefinition {
  key: string;
  /** Source that produces it. "combined" metrics are derived across sources. */
  source: DataSource | "combined";
  label: string;
  /** Plain-language definition, shown in tooltips and on the glossary page. */
  definition: string;
  format: MetricFormat;
  aggregation: Aggregation;
  /** true if an increase is good news (shown in teal), false if bad (coral). */
  upIsGood: boolean;
  /** Breakdown dimensions this metric can be stored with in metrics_daily. */
  dimensions?: string[];
  /** A building block for another metric (never shown on its own or in the glossary). */
  internal?: boolean;
  /** Glossary term this metric maps to, if any. */
  glossaryTerm?: string;
}
