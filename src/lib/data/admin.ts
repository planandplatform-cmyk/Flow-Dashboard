import "server-only";
import { headers } from "next/headers";
import { isDemoMode } from "@/lib/supabase/env";
import { adminApiConfigured, createAuthAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getViewer, type UserRole, type Viewer } from "./portal";

export interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  /** null when sign-in status is unknown (secret key not configured). */
  status: "active" | "invited" | null;
  last_sign_in_at: string | null;
}

export interface ClientSettings {
  id: string;
  name: string;
  slug: string;
  market: string | null;
  timezone: string;
  brand_color: string | null;
  logo_url: string | null;
  enabled_sources: string[];
  archived_at: string | null;
}

/** Admin-only pages: returns the viewer, or null for everyone else. */
export async function getAdminViewer(): Promise<Viewer | null> {
  const viewer = await getViewer();
  return viewer?.role === "ffm_admin" ? viewer : null;
}

export async function getClientSettings(slug: string): Promise<ClientSettings | null> {
  if (isDemoMode()) {
    const { default: fixture } = await import("@/lib/demo/fixture.json");
    const c = fixture.clients.find((x) => x.slug === slug);
    return c ? { ...c, archived_at: null } : null;
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, slug, market, timezone, brand_color, logo_url, enabled_sources, archived_at")
    .eq("slug", slug)
    .maybeSingle();
  return (data as ClientSettings | null) ?? null;
}

export async function listArchivedClients(): Promise<{ name: string; slug: string }[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("name, slug").not("archived_at", "is", null).order("name");
  return data ?? [];
}

async function withSignInStatus(users: Omit<Member, "status" | "last_sign_in_at">[]): Promise<Member[]> {
  if (!adminApiConfigured()) return users.map((u) => ({ ...u, status: null, last_sign_in_at: null }));
  const auth = createAuthAdminClient();
  return Promise.all(
    users.map(async (u) => {
      const { data } = await auth.getUserById(u.id);
      const last = data.user?.last_sign_in_at ?? null;
      return { ...u, status: last ? "active" : "invited", last_sign_in_at: last } as Member;
    }),
  );
}

/** People who can log in to one client's report. */
export async function listClientMembers(clientId: string): Promise<Member[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_clients")
    .select("user:users(id, email, full_name, role)")
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  const users = (data ?? [])
    .map((r) => r.user as unknown as Omit<Member, "status" | "last_sign_in_at"> | null)
    .filter((u): u is Omit<Member, "status" | "last_sign_in_at"> => Boolean(u))
    .sort((a, b) => a.email.localeCompare(b.email));
  return withSignInStatus(users);
}

/** Flow Forward Media staff and admins. */
export async function listTeam(): Promise<Member[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("users")
    .select("id, email, full_name, role")
    .in("role", ["ffm_admin", "ffm_staff"])
    .order("email");
  if (error) throw new Error(error.message);
  return withSignInStatus((data ?? []) as Omit<Member, "status" | "last_sign_in_at">[]);
}

/** Base URL for links in emails: SITE_URL if set, else the current request. */
export async function siteUrl(): Promise<string> {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export interface ConnectionStatus {
  propertyId: string | null;
  status: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  runs: { id: string; trigger: string; status: string; period_start: string; period_end: string; rows_upserted: number; error: string | null; started_at: string }[];
}

/** A synced channel's connection and recent syncs, for the Settings page. */
export async function getConnectionStatus(clientId: string, source: "ga4" | "search_console"): Promise<ConnectionStatus | null> {
  if (isDemoMode()) return null;
  const supabase = await createClient();
  const [{ data: c }, { data: runs }] = await Promise.all([
    supabase.from("connections").select("external_account_id, status, last_synced_at, last_error").eq("client_id", clientId).eq("source", source).maybeSingle(),
    supabase
      .from("sync_runs")
      .select("id, trigger, status, period_start, period_end, rows_upserted, error, started_at")
      .eq("client_id", clientId)
      .eq("source", source)
      .order("started_at", { ascending: false })
      .limit(5),
  ]);
  if (!c) return null;
  return {
    propertyId: c.external_account_id,
    status: c.status,
    lastSyncedAt: c.last_synced_at,
    lastError: c.last_error,
    runs: (runs ?? []) as ConnectionStatus["runs"],
  };
}
