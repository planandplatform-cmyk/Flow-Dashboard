import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export function adminApiConfigured(): boolean {
  return Boolean(SUPABASE_URL && SECRET_KEY);
}

/**
 * Supabase client with the secret key. It bypasses row-level security, so it
 * is used for one thing only: Supabase Auth admin calls (sending invites,
 * reading sign-in status). Every caller must check the viewer is an FFM admin
 * first. Database reads and writes always use the signed-in user's client.
 */
export function createAuthAdminClient() {
  if (!adminApiConfigured()) throw new Error("SUPABASE_SECRET_KEY is not set.");
  return createClient(SUPABASE_URL, SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}
