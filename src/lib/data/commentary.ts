import "server-only";
import { buildMonthFacts, type MonthFacts } from "@/lib/commentary/facts";
import { addMonths, monthRange } from "@/lib/dates";
import { MetricResolver, onlyEnabledSources, type DateRange } from "@/lib/metrics/aggregate";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  getAdCampaigns,
  getAnnotations,
  getAudienceSnapshots,
  getMetricData,
  getTopPosts,
  type Client,
  type Commentary,
} from "./portal";

/*
 * Reads for the FFM-only commentary, events and activity pages. Row-level
 * security limits all of these to FFM staff (drafts, audit log, sync runs).
 */

const demoFixture = async () => (await import("@/lib/demo/fixture.json")).default;

export interface EditableCommentary extends Commentary {
  published_at: string | null;
  updated_at: string | null;
}

export async function getCommentaryForEdit(clientId: string, month: string): Promise<EditableCommentary | null> {
  if (isDemoMode()) {
    const c = (await demoFixture()).commentary.find((x) => x.client_id === clientId && x.month === month);
    return c ? ({ ...c, published_at: null, updated_at: null } as unknown as EditableCommentary) : null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monthly_commentary")
    .select("month, headline, summary, platform_narratives, section_notes, conclusion, status, published_at, updated_at")
    .eq("client_id", clientId)
    .eq("month", month)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EditableCommentary | null) ?? null;
}

/** Commentary status per month, newest first. */
export async function listCommentaryStatus(clientId: string): Promise<{ month: string; status: "draft" | "published" }[]> {
  if (isDemoMode()) {
    return (await demoFixture()).commentary
      .filter((c) => c.client_id === clientId)
      .map((c) => ({ month: c.month, status: c.status as "draft" | "published" }));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("monthly_commentary")
    .select("month, status")
    .eq("client_id", clientId)
    .order("month", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { month: string; status: "draft" | "published" }[];
}

/**
 * The fact sheet for a month, built the way the report shows it: the client's
 * channels only, and for ads the full window of campaigns active that month.
 */
export async function loadMonthFacts(client: Client, month: string): Promise<MonthFacts> {
  const range = monthRange(month);
  const previous = monthRange(addMonths(month, -1));
  const enabled = new Set(client.enabled_sources);
  const campaigns = enabled.has("meta_ads") ? await getAdCampaigns(client.id, range) : [];
  const adsRange: DateRange | null = campaigns.length
    ? {
        start: campaigns.map((c) => c.start_date ?? range.start).sort()[0],
        end: campaigns.map((c) => c.end_date ?? range.end).sort().at(-1)!,
      }
    : null;
  // Wide enough for the ads window and the same number of days before it.
  const start = [previous.start, adsRange ? addDaysISO(adsRange.start, -(daySpan(adsRange) + 1)) : previous.start].sort()[0];
  const end = [range.end, adsRange?.end ?? range.end].sort().at(-1)!;

  const [data, posts, snapshots, annotations] = await Promise.all([
    getMetricData(client.id, { start, end }),
    getTopPosts(client.id, range, 5),
    getAudienceSnapshots(client.id, range),
    getAnnotations(client.id, range),
  ]);
  return buildMonthFacts({
    clientName: client.name,
    market: client.market,
    month,
    range,
    previous,
    enabled: client.enabled_sources,
    resolver: new MetricResolver(onlyEnabledSources(data, enabled)),
    ads: adsRange ? { range: adsRange, campaigns: campaigns.map((c) => c.name) } : null,
    posts,
    snapshots,
    annotations,
  });
}

const daySpan = (r: DateRange) => Math.round((Date.parse(r.end) - Date.parse(r.start)) / 86_400_000);
function addDaysISO(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Events (annotations)
// ---------------------------------------------------------------------------

export interface EventEntry {
  id: string;
  date: string;
  label: string;
  description: string | null;
  created_at: string | null;
  author: string | null;
}

export async function listEvents(clientId: string): Promise<EventEntry[]> {
  if (isDemoMode()) {
    return (await demoFixture()).annotations
      .filter((a) => a.client_id === clientId)
      .map((a, i) => ({ id: `demo-${i}`, date: a.date, label: a.label, description: a.description ?? null, created_at: null, author: null }));
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("annotations")
    .select("id, date, label, description, created_at, author:users!annotations_created_by_fkey(email)")
    .eq("client_id", clientId)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({
    id: a.id,
    date: a.date,
    label: a.label,
    description: a.description,
    created_at: a.created_at,
    author: (a.author as unknown as { email: string } | null)?.email ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Activity: the audit log plus automatic syncs
// ---------------------------------------------------------------------------

export interface ActivityEntry {
  id: string;
  at: string;
  kind: "audit" | "sync";
  action: string;
  actor: string | null;
  details: Record<string, unknown>;
  status?: "pending" | "running" | "succeeded" | "failed" | "rolled_back";
}

export async function listActivity(clientId: string, limit = 100): Promise<ActivityEntry[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const [audit, syncs] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, created_at, action, details, actor:users!audit_log_actor_id_fkey(email)")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("sync_runs")
      .select("id, started_at, source, trigger, period_start, period_end, status, rows_upserted, error, actor:users!sync_runs_triggered_by_fkey(email)")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(limit),
  ]);
  if (audit.error) throw new Error(audit.error.message);
  if (syncs.error) throw new Error(syncs.error.message);
  const email = (a: unknown) => (a as { email: string } | null)?.email ?? null;
  return [
    ...(audit.data ?? []).map((a) => ({
      id: `a${a.id}`,
      at: a.created_at,
      kind: "audit" as const,
      action: a.action,
      actor: email(a.actor),
      details: (a.details ?? {}) as Record<string, unknown>,
    })),
    ...(syncs.data ?? []).map((s) => ({
      id: `s${s.id}`,
      at: s.started_at,
      kind: "sync" as const,
      action: `sync.${s.trigger}`,
      actor: email(s.actor),
      details: { source: s.source, period_start: s.period_start, period_end: s.period_end, rows: s.rows_upserted, error: s.error },
      status: s.status,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Client health for the client list
// ---------------------------------------------------------------------------

export interface ClientHealth {
  lastDataDate: string | null;
  lastActivityAt: string | null;
  lastPublishedMonth: string | null;
  draftMonth: string | null;
  failedSync: { source: string; at: string } | null;
}

export async function getClientHealth(clientIds: string[]): Promise<Record<string, ClientHealth>> {
  if (isDemoMode()) {
    const fx = await demoFixture();
    return Object.fromEntries(
      clientIds.map((id) => [
        id,
        {
          lastDataDate: fx.metricsDaily.filter((r) => r.client_id === id).reduce<string | null>((m, r) => (m === null || r.date > m ? r.date : m), null),
          lastActivityAt: null,
          lastPublishedMonth: fx.commentary.filter((c) => c.client_id === id && c.status === "published").map((c) => c.month).sort().at(-1) ?? null,
          draftMonth: null,
          failedSync: null,
        },
      ]),
    );
  }
  const supabase = await createClient();
  const one = async (id: string): Promise<[string, ClientHealth]> => {
    const [daily, period, upload, published, draft, sync] = await Promise.all([
      supabase.from("metrics_daily").select("date").eq("client_id", id).order("date", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("metrics_period").select("period_end").eq("client_id", id).order("period_end", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("uploads").select("created_at").eq("client_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("monthly_commentary").select("month").eq("client_id", id).eq("status", "published").order("month", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("monthly_commentary").select("month").eq("client_id", id).eq("status", "draft").order("month", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("sync_runs").select("source, status, started_at").eq("client_id", id).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const dates = [daily.data?.date, period.data?.period_end].filter((d): d is string => Boolean(d)).sort();
    const activity = [upload.data?.created_at, sync.data?.started_at].filter((d): d is string => Boolean(d)).sort();
    return [
      id,
      {
        lastDataDate: dates.at(-1) ?? null,
        lastActivityAt: activity.at(-1) ?? null,
        lastPublishedMonth: published.data?.month ?? null,
        draftMonth: draft.data?.month ?? null,
        failedSync: sync.data?.status === "failed" ? { source: sync.data.source, at: sync.data.started_at } : null,
      },
    ];
  };
  return Object.fromEntries(await Promise.all(clientIds.map(one)));
}
