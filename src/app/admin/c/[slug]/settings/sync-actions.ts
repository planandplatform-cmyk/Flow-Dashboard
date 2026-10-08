"use server";

import { refresh } from "next/cache";
import { Ga4Error, checkGa4Property } from "@/lib/connectors/ga4";
import { GoogleAuthError, googleConfigured } from "@/lib/connectors/google-auth";
import { GscError, checkGscSite } from "@/lib/connectors/gsc";
import { parseSiteUrl } from "@/lib/connectors/gsc-map";
import { parsePropertyId } from "@/lib/connectors/property-id";
import { syncClient } from "@/lib/connectors/run";
import { SYNC_SOURCES, type SyncSource } from "@/lib/connectors/sync";
import { isISODate } from "@/lib/dates";
import { getAdminViewer, getClientSettings } from "@/lib/data/admin";
import { auditAction } from "@/lib/data/authorize";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { adminApiConfigured } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * Automatic data (GA4, Search Console). Admins only: checked here, and by
 * row-level security on the connections table. Syncs write with the service
 * client only after that check. Every action is audited.
 */

export type SyncState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; message: string };

async function admin(slug: string, source: SyncSource): Promise<{ clientId: string; viewerId: string } | SyncState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to turn on automatic data." };
  if (!(SYNC_SOURCES as readonly string[]).includes(source)) return { status: "error", message: "Unknown channel." };
  const viewer = await getAdminViewer();
  if (!viewer) return { status: "error", message: "Only Flow Forward Media admins can do this." };
  if (!googleConfigured()) return { status: "error", message: "GOOGLE_SERVICE_ACCOUNT_KEY is not set in Vercel. See the setup steps." };
  if (!adminApiConfigured()) return { status: "error", message: "SUPABASE_SECRET_KEY is not set in Vercel. Automatic syncs need it." };
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  return { clientId: client.id, viewerId: viewer.id };
}

const rowsText = (n: number) => `${n.toLocaleString("en-US")} numbers`;

/** The account ID from the form, checked with Google before anything is saved. */
async function checkedAccount(source: SyncSource, raw: string): Promise<string | SyncState> {
  const id = source === "ga4" ? parsePropertyId(raw) : parseSiteUrl(raw);
  if (!id) {
    return {
      status: "error",
      message:
        source === "ga4"
          ? "Enter the numeric Property ID from GA4 Admin, Property details (for example 412345678), not the G- measurement ID."
          : "Enter the site as Search Console shows it: example.com for a domain property, or the full address like https://www.example.com/.",
    };
  }
  try {
    if (source === "ga4") await checkGa4Property(id);
    else await checkGscSite(id);
  } catch (e) {
    if (e instanceof Ga4Error || e instanceof GscError || e instanceof GoogleAuthError) return { status: "error", message: e.message };
    throw e;
  }
  return id;
}

export async function connectSource(slug: string, source: SyncSource, _prev: SyncState, form: FormData): Promise<SyncState> {
  const auth = await admin(slug, source);
  if ("status" in auth) return auth;
  const accountId = await checkedAccount(source, String(form.get("account_id") ?? ""));
  if (typeof accountId !== "string") return accountId;

  // Update or insert, not upsert: an upsert also rewrites client_id and
  // source, which row-level grants keep fixed.
  const supabase = await createClient();
  const { data: existing } = await supabase.from("connections").select("id").eq("client_id", auth.clientId).eq("source", source).maybeSingle();
  const { error } = existing
    ? await supabase.from("connections").update({ external_account_id: accountId, status: "active" }).eq("id", existing.id)
    : await supabase.from("connections").insert({ client_id: auth.clientId, source, external_account_id: accountId, status: "active" });
  if (error) return { status: "error", message: `Not saved. ${error.message}` };
  await auditAction(auth.clientId, "connection.connect", { source, account_id: accountId });

  const result = await syncClient(auth.clientId, source, "history", "backfill", auth.viewerId);
  await auditAction(auth.clientId, "sync.backfill", { source, ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  if (!result.ok) return { status: "error", message: `Connected, but the history pull failed. ${result.error}` };
  return { status: "done", message: `Connected. Pulled the last 13 months (${rowsText(result.rows)}). It now updates every night.` };
}

export async function syncNow(slug: string, source: SyncSource): Promise<SyncState> {
  const auth = await admin(slug, source);
  if ("status" in auth) return auth;
  const result = await syncClient(auth.clientId, source, "recent", "manual", auth.viewerId);
  await auditAction(auth.clientId, "sync.manual", { source, ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  return result.ok ? { status: "done", message: `Updated the last 30 days (${rowsText(result.rows)}).` } : { status: "error", message: result.error ?? "Sync failed." };
}

export async function pullHistory(slug: string, source: SyncSource, _prev: SyncState, form: FormData): Promise<SyncState> {
  const auth = await admin(slug, source);
  if ("status" in auth) return auth;
  const start = String(form.get("start") ?? "");
  const end = String(form.get("end") ?? "");
  if (!isISODate(start) || !isISODate(end) || end < start) return { status: "error", message: "Pick a start date and an end date after it." };
  const result = await syncClient(auth.clientId, source, { start, end }, "backfill", auth.viewerId);
  await auditAction(auth.clientId, "sync.backfill", { source, start, end, ok: result.ok, rows: result.rows, run_id: result.runId });
  refresh();
  return result.ok ? { status: "done", message: `Pulled ${start} to ${end} (${rowsText(result.rows)}).` } : { status: "error", message: result.error ?? "Sync failed." };
}

export async function disconnectSource(slug: string, source: SyncSource): Promise<SyncState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode." };
  const viewer = await getAdminViewer();
  if (!viewer) return { status: "error", message: "Only Flow Forward Media admins can do this." };
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("connections").update({ status: "not_connected" }).eq("client_id", client.id).eq("source", source);
  if (error) return { status: "error", message: error.message };
  await auditAction(client.id, "connection.disconnect", { source });
  refresh();
  return { status: "done", message: `Automatic ${SOURCE_LABELS[source]} updates are off. The numbers already pulled stay in the report.` };
}
