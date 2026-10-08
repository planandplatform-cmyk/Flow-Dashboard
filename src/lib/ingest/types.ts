import type { DataSource } from "@/lib/metrics/types";

/** One worksheet (or one CSV file) as a grid of trimmed strings. */
export interface Sheet {
  name: string;
  rows: string[][];
}

export interface Period {
  start: string; // YYYY-MM-DD
  end: string;
}

export interface ParseContext {
  fileName: string;
  /** Source the admin picked. Undefined means auto-detect. */
  source?: DataSource;
  /** Period the admin entered; used when the file itself has no dates. */
  period?: Period;
  /** Today's date (YYYY-MM-DD), for exports that omit the year. */
  today: string;
}

// ---------------------------------------------------------------------------
// Normalized rows. This is what every parser and the manual entry form
// produce, and what the database commit function accepts.
// ---------------------------------------------------------------------------

export interface DailyIn {
  source: DataSource;
  metric_key: string;
  date: string;
  dimension: string;
  dimension_value: string;
  value: number;
}

export interface PeriodIn {
  source: DataSource;
  metric_key: string;
  period_start: string;
  period_end: string;
  dimension: string;
  dimension_value: string;
  value: number;
}

export interface PostIn {
  platform: DataSource;
  external_id: string;
  published_at: string; // ISO timestamp
  format: "reel" | "photo" | "carousel" | "link" | "video" | "story" | "text" | "other";
  caption: string | null;
  summary: string | null;
  permalink: string | null;
  views: number | null;
  reach: number | null;
  interactions: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
}

export type BreakdownType =
  | "age"
  | "gender"
  | "country"
  | "city"
  | "language"
  | "discovery_surface"
  | "follower_status"
  | "follower_status_engagement"
  | "format_engagement"
  | "format_views"
  | "job_function"
  | "seniority"
  | "industry"
  | "company_size"
  | "device";

export interface SnapshotIn {
  platform: DataSource;
  snapshot_date: string;
  period_start: string | null;
  breakdown_type: BreakdownType;
  bucket: string;
  share: number; // 0..1
}

export interface CampaignIn {
  source: "meta_ads";
  external_campaign_id: string;
  name: string;
  objective: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface AdDailyIn {
  external_campaign_id: string;
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  leads: number;
}

export interface IngestBatch {
  daily: DailyIn[];
  period: PeriodIn[];
  posts: PostIn[];
  snapshots: SnapshotIn[];
  adCampaigns: CampaignIn[];
  adDaily: AdDailyIn[];
}

export interface MetricTotal {
  source: DataSource;
  metric_key: string;
  value: number;
}

export interface ParseResult {
  ok: boolean;
  parserId: string;
  parserLabel: string;
  sources: DataSource[];
  batch: IngestBatch;
  periodStart: string | null;
  periodEnd: string | null;
  granularity: "daily" | "period" | "mixed" | "lifetime" | "snapshot";
  rowsRead: number;
  mappedColumns: string[];
  unmappedColumns: string[];
  duplicatesInFile: number;
  /** Totals per metric across the file, for a quick check against the platform. */
  totals: MetricTotal[];
  warnings: string[];
  errors: string[];
}

export interface Parser {
  id: string;
  label: string;
  /** Sources this parser can produce. */
  sources: DataSource[];
  /** Confidence 0..1 that this parser understands the file. */
  detect(sheets: Sheet[], ctx: ParseContext): number;
  parse(sheets: Sheet[], ctx: ParseContext, out: import("./batch").BatchBuilder): void;
}
