export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

/**
 * Demo mode renders the seeded Wieler Roofing data from a local fixture with
 * no login, so the portal can be previewed before Supabase is set up. It is
 * only ever active in development, and only when Supabase is not configured.
 */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}
