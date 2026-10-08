import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyIn, PeriodIn } from "@/lib/ingest/types";
import type { DateRange } from "@/lib/metrics/aggregate";
import { GoogleAuthError } from "./google-auth";
import { Ga4Error, runGa4Report } from "./ga4";
import { ga4Requests, mapGa4Report } from "./ga4-map";
import { GscError, runGscReport } from "./gsc";
import { gscRequests, mapGscReport } from "./gsc-map";
import { replaceWindow } from "./sync-plan";

/** Channels the portal pulls automatically. */
export const SYNC_SOURCES = ["ga4", "search_console"] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

type Rows = { daily: DailyIn[]; period: PeriodIn[] };

/** Every report for a range, fetched a few at a time, as portal rows. */
async function pull(source: SyncSource, accountId: string, range: DateRange): Promise<Rows[]> {
  if (source === "ga4") return inBatches(ga4Requests(range), CONCURRENCY, async (req) => mapGa4Report(req, await runGa4Report(accountId, req)));
  return inBatches(gscRequests(range), CONCURRENCY, async (req) => mapGscReport(req, await runGscReport(accountId, req)));
}

export interface SyncResult {
  ok: boolean;
  rows: number;
  error: string | null;
  runId: string | null;
}

interface SyncTarget {
  clientId: string;
  connectionId: string;
  source: SyncSource;
  /** GA4 property ID or Search Console site. */
  accountId: string;
}

const CONCURRENCY = 4;
const CHUNK = 1000;

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Same row twice in one pull (GA4 never does this, but the unique key would reject the batch). */
function dedupe<T>(rows: T[], key: (r: T) => string): T[] {
  return [...new Map(rows.map((r) => [key(r), r])).values()];
}

/**
 * Pull one channel for one client and date range, replacing what was there.
 *
 * Writes with the service client (callers check access first). The new rows
 * are written before the old ones are removed, so a failed pull never leaves
 * a gap: the previous numbers stay until a pull fully succeeds.
 */
export async function syncSource(
  db: SupabaseClient,
  target: SyncTarget,
  range: DateRange,
  trigger: "scheduled" | "manual" | "backfill",
  triggeredBy: string | null,
): Promise<SyncResult> {
  const { data: run, error: runError } = await db
    .from("sync_runs")
    .insert({
      client_id: target.clientId,
      connection_id: target.connectionId,
      source: target.source,
      trigger,
      triggered_by: triggeredBy,
      period_start: range.start,
      period_end: range.end,
      status: "running",
    })
    .select("id")
    .single();
  if (runError || !run) return { ok: false, rows: 0, error: `Could not start the sync: ${runError?.message}`, runId: null };
  const runId = run.id as string;

  try {
    const reports = await pull(target.source, target.accountId, range);
    const stamp = { client_id: target.clientId, sync_run_id: runId, upload_id: null, updated_at: new Date().toISOString() };
    const daily = dedupe(
      reports.flatMap((r) => r.daily),
      (r: DailyIn) => `${r.metric_key}|${r.date}|${r.dimension}|${r.dimension_value}`,
    ).map((r) => ({ ...r, ...stamp }));
    const period = dedupe(
      reports.flatMap((r) => r.period),
      (r: PeriodIn) => `${r.metric_key}|${r.period_start}|${r.period_end}|${r.dimension}|${r.dimension_value}`,
    ).map((r) => ({ ...r, ...stamp }));

    for (let i = 0; i < daily.length; i += CHUNK) {
      const { error } = await db
        .from("metrics_daily")
        .upsert(daily.slice(i, i + CHUNK), { onConflict: "client_id,source,metric_key,date,dimension,dimension_value" });
      if (error) throw new Error(`Saving daily numbers failed: ${error.message}`);
    }
    for (let i = 0; i < period.length; i += CHUNK) {
      const { error } = await db
        .from("metrics_period")
        .upsert(period.slice(i, i + CHUNK), { onConflict: "client_id,source,metric_key,period_start,period_end,dimension,dimension_value" });
      if (error) throw new Error(`Saving monthly numbers failed: ${error.message}`);
    }

    // Everything else this channel had for these dates is replaced by this pull.
    const win = replaceWindow(range);
    const notThisRun = `sync_run_id.is.null,sync_run_id.neq.${runId}`;
    const staleDaily = await db
      .from("metrics_daily")
      .delete()
      .eq("client_id", target.clientId)
      .eq("source", target.source)
      .gte("date", win.daily.start)
      .lte("date", win.daily.end)
      .or(notThisRun);
    if (staleDaily.error) throw new Error(`Clearing old daily numbers failed: ${staleDaily.error.message}`);
    const stalePeriod = await db
      .from("metrics_period")
      .delete()
      .eq("client_id", target.clientId)
      .eq("source", target.source)
      .gte("period_start", win.period.start)
      .lte("period_end", win.period.end)
      .or(notThisRun);
    if (stalePeriod.error) throw new Error(`Clearing old monthly numbers failed: ${stalePeriod.error.message}`);

    const rows = daily.length + period.length;
    const now = new Date().toISOString();
    await db.from("sync_runs").update({ status: "succeeded", rows_upserted: rows, finished_at: now }).eq("id", runId);
    await db.from("connections").update({ status: "active", last_synced_at: now, last_error: null, last_error_at: null, updated_at: now }).eq("id", target.connectionId);
    return { ok: true, rows, error: null, runId };
  } catch (e) {
    const message =
      e instanceof Ga4Error || e instanceof GscError || e instanceof GoogleAuthError ? e.message : `The sync stopped: ${e instanceof Error ? e.message : String(e)}`;
    const now = new Date().toISOString();
    await db.from("sync_runs").update({ status: "failed", error: message, finished_at: now }).eq("id", runId);
    await db.from("connections").update({ status: "error", last_error: message, last_error_at: now, updated_at: now }).eq("id", target.connectionId);
    return { ok: false, rows: 0, error: message, runId };
  }
}
