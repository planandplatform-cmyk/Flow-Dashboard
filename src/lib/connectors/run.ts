import "server-only";
import { todayIn } from "@/lib/dates";
import type { DateRange } from "@/lib/metrics/aggregate";
import { createServiceClient } from "@/lib/supabase/admin";
import { SYNC_SOURCES, syncSource, type SyncResult, type SyncSource } from "./sync";
import { clipRange, syncWindow, type SyncKind } from "./sync-plan";

interface Connection {
  id: string;
  client_id: string;
  source: SyncSource;
  external_account_id: string | null;
  status: string;
  clients: { timezone: string; archived_at: string | null } | null;
}

const COLUMNS = "id, client_id, source, external_account_id, status, clients(timezone, archived_at)";

/**
 * Sync one client's channel. The caller has checked the viewer is an FFM
 * admin (server actions) or the request is the nightly job (cron route).
 */
export async function syncClient(
  clientId: string,
  source: SyncSource,
  what: SyncKind | DateRange,
  trigger: "scheduled" | "manual" | "backfill",
  triggeredBy: string | null,
): Promise<SyncResult> {
  const db = createServiceClient();
  const { data: connection } = await db.from("connections").select(COLUMNS).eq("client_id", clientId).eq("source", source).maybeSingle<Connection>();
  if (!connection?.external_account_id || connection.status === "not_connected") {
    return { ok: false, rows: 0, error: "This channel is not connected for this client.", runId: null };
  }
  const today = todayIn(connection.clients?.timezone ?? "America/Chicago");
  const range = typeof what === "string" ? syncWindow(what, today) : clipRange(what, today);
  if (!range) return { ok: false, rows: 0, error: "Pick dates before today.", runId: null };
  return syncSource(db, { clientId, connectionId: connection.id, source, accountId: connection.external_account_id }, range, trigger, triggeredBy);
}

export interface NightlyResult {
  client_id: string;
  source: SyncSource;
  ok: boolean;
  rows: number;
  error: string | null;
}

/** The nightly job: last 30 days of every connected channel for every non-archived client. */
export async function syncAll(): Promise<NightlyResult[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("connections")
    .select(COLUMNS)
    .in("source", [...SYNC_SOURCES])
    .in("status", ["active", "error"])
    .not("external_account_id", "is", null)
    .returns<Connection[]>();
  const live = (data ?? []).filter((c) => c.clients && !c.clients.archived_at);
  const out: NightlyResult[] = [];
  // A few at a time keeps each Google property well under its limits.
  for (let i = 0; i < live.length; i += 3) {
    const batch = await Promise.all(
      live.slice(i, i + 3).map(async (c) => {
        const r = await syncClient(c.client_id, c.source, "recent", "scheduled", null);
        return { client_id: c.client_id, source: c.source, ok: r.ok, rows: r.rows, error: r.error };
      }),
    );
    out.push(...batch);
  }
  return out;
}
