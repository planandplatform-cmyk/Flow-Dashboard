import "server-only";
import { todayIn } from "@/lib/dates";
import type { DateRange } from "@/lib/metrics/aggregate";
import { createServiceClient } from "@/lib/supabase/admin";
import { syncGa4, type SyncResult } from "./sync";
import { clipRange, syncWindow, type SyncKind } from "./sync-plan";

interface Ga4Connection {
  id: string;
  client_id: string;
  external_account_id: string | null;
  status: string;
  clients: { timezone: string; archived_at: string | null } | null;
}

async function ga4Connection(clientId: string) {
  const db = createServiceClient();
  const { data } = await db
    .from("connections")
    .select("id, client_id, external_account_id, status, clients(timezone, archived_at)")
    .eq("client_id", clientId)
    .eq("source", "ga4")
    .maybeSingle<Ga4Connection>();
  return { db, connection: data };
}

/**
 * Sync one client's GA4. The caller has checked the viewer is an FFM admin
 * (server actions) or the request is the nightly job (cron route).
 */
export async function syncClientGa4(
  clientId: string,
  what: SyncKind | DateRange,
  trigger: "scheduled" | "manual" | "backfill",
  triggeredBy: string | null,
): Promise<SyncResult> {
  const { db, connection } = await ga4Connection(clientId);
  if (!connection?.external_account_id || connection.status === "not_connected") return { ok: false, rows: 0, error: "Google Analytics is not connected for this client.", runId: null };
  const today = todayIn(connection.clients?.timezone ?? "America/Chicago");
  const range = typeof what === "string" ? syncWindow(what, today) : clipRange(what, today);
  if (!range) return { ok: false, rows: 0, error: "Pick dates before today.", runId: null };
  return syncGa4(db, { clientId, connectionId: connection.id, propertyId: connection.external_account_id }, range, trigger, triggeredBy);
}

/** The nightly job: last 30 days for every connected, non-archived client. */
export async function syncAllGa4(): Promise<{ client_id: string; ok: boolean; rows: number; error: string | null }[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("connections")
    .select("id, client_id, external_account_id, status, clients(timezone, archived_at)")
    .eq("source", "ga4")
    .in("status", ["active", "error"])
    .not("external_account_id", "is", null)
    .returns<Ga4Connection[]>();
  const live = (data ?? []).filter((c) => c.clients && !c.clients.archived_at);
  const out: { client_id: string; ok: boolean; rows: number; error: string | null }[] = [];
  // A few clients at a time keeps each GA4 property well under its limits.
  for (let i = 0; i < live.length; i += 3) {
    const batch = await Promise.all(
      live.slice(i, i + 3).map(async (c) => {
        const r = await syncClientGa4(c.client_id, "recent", "scheduled", null);
        return { client_id: c.client_id, ok: r.ok, rows: r.rows, error: r.error };
      }),
    );
    out.push(...batch);
  }
  return out;
}
