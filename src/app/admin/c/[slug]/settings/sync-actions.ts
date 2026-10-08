"use server";

import { refresh } from "next/cache";
import { parsePropertyId } from "@/lib/connectors/property-id";
import { Ga4Error, checkGa4Property } from "@/lib/connectors/ga4";
import { GoogleAuthError, googleConfigured } from "@/lib/connectors/google-auth";
import { syncClientGa4 } from "@/lib/connectors/run";
import { isISODate } from "@/lib/dates";
import { getAdminViewer, getClientSettings } from "@/lib/data/admin";
import { auditAction } from "@/lib/data/authorize";
import { adminApiConfigured } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * Automatic data (GA4). Admins only: checked here, and by row-level security
 * on the connections table. Syncs write with the service client only after
 * that check. Every action is audited.
 */

export type SyncState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; message: string };

async function admin(slug: string): Promise<{ clientId: string; viewerId: string } | SyncState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to turn on automatic data." };
  const viewer = await getAdminViewer();
  if (!viewer) return { status: "error", message: "Only Flow Forward Media admins can do this." };
  if (!googleConfigured()) return { status: "error", message: "GOOGLE_SERVICE_ACCOUNT_KEY is not set in Vercel. See the setup steps." };
  if (!adminApiConfigured()) return { status: "error", message: "SUPABASE_SECRET_KEY is not set in Vercel. Automatic syncs need it." };
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  return { clientId: client.id, viewerId: viewer.id };
}

const rowsText = (n: number) => `${n.toLocaleString("en-US")} numbers`;

export async function connectGa4(slug: string, _prev: SyncState, form: FormData): Promise<SyncState> {
  const auth = await admin(slug);
  if ("status" in auth) return auth;
  const propertyId = parsePropertyId(String(form.get("property_id") ?? ""));
  if (!propertyId) {
    return { status: "error", message: "Enter the numeric Property ID from GA4 Admin, Property details (for example 412345678), not the G- measurement ID." };
  }
  try {
    await checkGa4Property(propertyId);
  } catch (e) {
    if (e instanceof Ga4Error || e instanceof GoogleAuthError) return { status: "error", message: e.message };
    throw e;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("connections")
    .upsert({ client_id: auth.clientId, source: "ga4", external_account_id: propertyId, status: "active" }, { onConflict: "client_id,source" });
  if (error) return { status: "error", message: `Not saved. ${error.message}` };
  await auditAction(auth.clientId, "connection.connect", { source: "ga4", property_id: propertyId });

  const result = await syncClientGa4(auth.clientId, "history", "backfill", auth.viewerId);
  await auditAction(auth.clientId, "sync.backfill", { source: "ga4", ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  if (!result.ok) return { status: "error", message: `Connected, but the history pull failed. ${result.error}` };
  return { status: "done", message: `Connected. Pulled the last 13 months (${rowsText(result.rows)}). It now updates every night.` };
}

export async function syncGa4Now(slug: string): Promise<SyncState> {
  const auth = await admin(slug);
  if ("status" in auth) return auth;
  const result = await syncClientGa4(auth.clientId, "recent", "manual", auth.viewerId);
  await auditAction(auth.clientId, "sync.manual", { source: "ga4", ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  return result.ok ? { status: "done", message: `Updated the last 30 days (${rowsText(result.rows)}).` } : { status: "error", message: result.error ?? "Sync failed." };
}

export async function pullGa4History(slug: string, _prev: SyncState, form: FormData): Promise<SyncState> {
  const auth = await admin(slug);
  if ("status" in auth) return auth;
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (!isISODate(start) || !isISODate(end) || end < start) return { status: "error", message: "Pick a start date and an end date after it." };
  const result = await syncClientGa4(auth.clientId, { start, end }, "backfill", auth.viewerId);
  await auditAction(auth.clientId, "sync.backfill", { source: "ga4", start, end, ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  return result.ok ? { status: "done", message: `Pulled ${start} to ${end} (${rowsText(result.rows)}).` } : { status: "error", message: result.error ?? "Sync failed." };
}

export async function disconnectGa4(slug: string): Promise<SyncState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode." };
  const viewer = await getAdminViewer();
  if (!viewer) return { status: "error", message: "Only Flow Forward Media admins can do this." };
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("connections").update({ status: "not_connected" }).eq("client_id", client.id).eq("source", "ga4");
  if (error) return { status: "error", message: error.message };
  await auditAction(client.id, "connection.disconnect", { source: "ga4" });
  refresh();
  return { status: "done", message: "Automatic GA4 updates are off. The numbers already pulled stay in the report." };
}
