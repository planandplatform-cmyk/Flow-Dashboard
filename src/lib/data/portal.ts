import "server-only";
import { cache } from "react";
import fixture from "@/lib/demo/fixture.json";
import type { DailyRow, DateRange, MetricData, PeriodRow } from "@/lib/metrics/aggregate";
import type { DataSource } from "@/lib/metrics/types";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { adRowsToDaily, type AdMetricsDailyRow } from "./ads";

/*
 * All portal reads go through here. With Supabase, queries run as the
 * signed-in user, so row-level security decides what comes back. In demo mode
 * (development without Supabase) the seeded fixture is served instead.
 */

export type UserRole = "ffm_admin" | "ffm_staff" | "client_viewer";

export interface Viewer {
  id: string;
  email: string;
  role: UserRole;
  demo: boolean;
}

export interface Client {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  brand_color: string | null;
  enabled_sources: DataSource[];
  timezone: string;
  market: string | null;
}

export interface Post {
  platform: DataSource;
  external_id: string;
  published_at: string;
  format: string;
  summary: string | null;
  caption?: string | null;
  permalink?: string | null;
  views: number | null;
  interactions?: number | null;
}

export interface AudienceSnapshot {
  platform: DataSource;
  breakdown_type: string;
  bucket: string;
  share: number;
  snapshot_date: string;
  period_start: string | null;
}

export interface PlatformNarrative {
  headline?: string;
  body?: string;
}

export interface Commentary {
  month: string;
  headline: string | null;
  summary: string | null;
  platform_narratives: Partial<Record<DataSource, PlatformNarrative>>;
  section_notes: Record<string, string>;
  conclusion: string | null;
  status: "draft" | "published";
}

export interface Annotation {
  date: string;
  label: string;
  description: string | null;
}

export interface AdCampaign {
  id: string;
  name: string;
  objective: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
}

const isFfm = (role: UserRole) => role === "ffm_admin" || role === "ffm_staff";
export { isFfm };

const PAGE = 1000; // PostgREST default max rows per request

/** Page through a query so large ranges are never silently truncated. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

// ---------------------------------------------------------------------------
// Viewer and clients
// ---------------------------------------------------------------------------

export const getViewer = cache(async (): Promise<Viewer | null> => {
  if (isDemoMode()) return { id: "demo", email: "demo@flowforwardmedia.com", role: "ffm_admin", demo: true };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) return null;

  const { data, error } = await supabase.from("users").select("id, email, role").eq("id", userId).single();
  if (error || !data) return null;
  return { ...data, demo: false } as Viewer;
});

const CLIENT_COLUMNS = "id, name, slug, logo_url, brand_color, enabled_sources, timezone, market";

export const listClients = cache(async (): Promise<Client[]> => {
  if (isDemoMode()) return [fixture.client as Client];
  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").select(CLIENT_COLUMNS).is("archived_at", null).order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as Client[];
});

export const getClientBySlug = cache(async (slug: string): Promise<Client | null> => {
  if (isDemoMode()) return fixture.client.slug === slug ? (fixture.client as Client) : null;
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select(CLIENT_COLUMNS).eq("slug", slug).maybeSingle();
  return (data as Client | null) ?? null;
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

/**
 * Daily and period rows covering a range, with ad delivery folded in as
 * ads_* metric keys. Pass the union of current and comparison ranges.
 */
export async function getMetricData(clientId: string, range: DateRange): Promise<MetricData> {
  if (isDemoMode()) {
    const inRange = (d: string) => d >= range.start && d <= range.end;
    return {
      daily: [
        ...(fixture.metricsDaily as DailyRow[]).filter((r) => inRange(r.date)),
        ...adRowsToDaily(fixture.adMetricsDaily.filter((r) => inRange(r.date))),
      ],
      period: (fixture.metricsPeriod as PeriodRow[]).filter((r) => r.period_start <= range.end && r.period_end >= range.start),
    };
  }

  const supabase = await createClient();
  const [daily, period, ads] = await Promise.all([
    fetchAll<DailyRow>((from, to) =>
      supabase
        .from("metrics_daily")
        .select("metric_key, date, value, dimension, dimension_value")
        .eq("client_id", clientId)
        .gte("date", range.start)
        .lte("date", range.end)
        .order("id")
        .range(from, to),
    ),
    fetchAll<PeriodRow>((from, to) =>
      supabase
        .from("metrics_period")
        .select("metric_key, period_start, period_end, value, dimension, dimension_value")
        .eq("client_id", clientId)
        // Any period overlapping the range; the resolver prorates partial ones.
        .lte("period_start", range.end)
        .gte("period_end", range.start)
        .order("id")
        .range(from, to),
    ),
    fetchAll<AdMetricsDailyRow>((from, to) =>
      supabase
        .from("ad_metrics_daily")
        .select("date, spend, impressions, reach, clicks, leads")
        .eq("client_id", clientId)
        .gte("date", range.start)
        .lte("date", range.end)
        .order("id")
        .range(from, to),
    ),
  ]);

  // numeric columns arrive as strings from PostgREST
  const num = <T extends { value: number | string }>(r: T) => ({ ...r, value: Number(r.value) });
  return { daily: [...daily.map(num), ...adRowsToDaily(ads)], period: period.map(num) };
}

/** Last date with any metric data for the client, or null. */
export async function getLatestDataDate(clientId: string): Promise<string | null> {
  if (isDemoMode()) {
    return fixture.metricsDaily.reduce<string | null>((max, r) => (max === null || r.date > max ? r.date : max), null);
  }
  const supabase = await createClient();
  const [daily, period] = await Promise.all([
    supabase.from("metrics_daily").select("date").eq("client_id", clientId).order("date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("metrics_period").select("period_end").eq("client_id", clientId).order("period_end", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const dates = [daily.data?.date, period.data?.period_end].filter((d): d is string => Boolean(d)).sort();
  return dates.at(-1) ?? null;
}

// ---------------------------------------------------------------------------
// Content, audience, ads, commentary
// ---------------------------------------------------------------------------

export async function getTopPosts(clientId: string, range: DateRange, limit = 10): Promise<Post[]> {
  if (isDemoMode()) {
    return (fixture.posts as unknown as Post[])
      .filter((p) => p.published_at.slice(0, 10) >= range.start && p.published_at.slice(0, 10) <= range.end)
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, limit);
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select("platform, external_id, published_at, format, summary, caption, permalink, views, interactions")
    .eq("client_id", clientId)
    .gte("published_at", `${range.start}T00:00:00Z`)
    .lte("published_at", `${range.end}T23:59:59Z`)
    .order("views", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ ...p, views: p.views === null ? null : Number(p.views) })) as Post[];
}

/** The latest snapshot of each breakdown type at or before the range end. */
export async function getAudienceSnapshots(clientId: string, range: DateRange): Promise<AudienceSnapshot[]> {
  let rows: AudienceSnapshot[];
  if (isDemoMode()) {
    rows = (fixture.audienceSnapshots as AudienceSnapshot[]).filter((s) => s.snapshot_date <= range.end);
  } else {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("audience_snapshots")
      .select("platform, breakdown_type, bucket, share, snapshot_date, period_start")
      .eq("client_id", clientId)
      .lte("snapshot_date", range.end)
      .order("snapshot_date", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    rows = (data ?? []).map((s) => ({ ...s, share: Number(s.share) })) as AudienceSnapshot[];
  }
  const latest = new Map<string, string>();
  for (const r of rows) {
    const k = `${r.platform}|${r.breakdown_type}`;
    if (!latest.has(k) || r.snapshot_date > latest.get(k)!) latest.set(k, r.snapshot_date);
  }
  return rows
    .filter((r) => latest.get(`${r.platform}|${r.breakdown_type}`) === r.snapshot_date)
    .sort((a, b) => b.share - a.share);
}

/** Campaigns that were active at any point in the range. */
export async function getAdCampaigns(clientId: string, range: DateRange): Promise<AdCampaign[]> {
  const overlaps = (c: AdCampaign) => (c.start_date ?? "") <= range.end && (c.end_date ?? "9999-12-31") >= range.start;
  if (isDemoMode()) return (fixture.adCampaigns as AdCampaign[]).filter(overlaps);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ad_campaigns")
    .select("id, name, objective, status, start_date, end_date")
    .eq("client_id", clientId)
    .order("start_date");
  if (error) throw new Error(error.message);
  return ((data ?? []) as AdCampaign[]).filter(overlaps);
}

/** Commentary for a month. RLS hides drafts from client users. */
export async function getCommentary(clientId: string, month: string): Promise<Commentary | null> {
  if (isDemoMode()) return (fixture.commentary.find((c) => c.month === month) as Commentary | undefined) ?? null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("monthly_commentary")
    .select("month, headline, summary, platform_narratives, section_notes, conclusion, status")
    .eq("client_id", clientId)
    .eq("month", month)
    .maybeSingle();
  return (data as Commentary | null) ?? null;
}

/** Most recent month with published commentary, if any. */
export async function getLatestPublishedMonth(clientId: string): Promise<string | null> {
  if (isDemoMode()) {
    return fixture.commentary.filter((c) => c.status === "published").map((c) => c.month).sort().at(-1) ?? null;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("monthly_commentary")
    .select("month")
    .eq("client_id", clientId)
    .eq("status", "published")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.month ?? null;
}

export async function getAnnotations(clientId: string, range: DateRange): Promise<Annotation[]> {
  if (isDemoMode()) return fixture.annotations.filter((a) => a.date >= range.start && a.date <= range.end);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("annotations")
    .select("date, label, description")
    .eq("client_id", clientId)
    .gte("date", range.start)
    .lte("date", range.end)
    .order("date");
  if (error) throw new Error(error.message);
  return (data ?? []) as Annotation[];
}
