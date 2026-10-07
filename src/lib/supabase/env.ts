/** Strip whitespace and quotes that often come along when pasting values. */
function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * Accept the forms people paste: with or without https://, with a trailing
 * slash, or the API endpoint (".../rest/v1"). Always yields the bare origin.
 */
export function normalizeSupabaseUrl(raw: string | undefined): string {
  let value = clean(raw);
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}

// NEXT_PUBLIC_ values are inlined at build time, so they must be read directly.
export const SUPABASE_URL = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = clean(
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** A plain-English description of what is wrong with the Supabase settings, or null. */
export function supabaseConfigProblem(): string | null {
  if (!SUPABASE_URL) return "NEXT_PUBLIC_SUPABASE_URL is not set.";
  let url: URL | null = null;
  try {
    url = new URL(SUPABASE_URL);
  } catch {
    /* handled below */
  }
  if (!url || !url.hostname.includes(".")) {
    return "NEXT_PUBLIC_SUPABASE_URL is not a web address. It should look like https://abcdefgh.supabase.co (Supabase: Project Settings, Data API).";
  }
  if (!SUPABASE_PUBLISHABLE_KEY) return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set.";
  if (SUPABASE_PUBLISHABLE_KEY.startsWith("sb_secret_")) {
    return "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains the SECRET key. Use the publishable key there, and rotate the secret key in Supabase since it may have been exposed.";
  }
  return null;
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfigProblem() === null;
}

/**
 * Demo mode renders the seeded Wieler Roofing data from a local fixture with
 * no login, so the portal can be previewed before Supabase is set up. It is
 * only ever active in development, and only when Supabase is not configured.
 */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV !== "production" && !isSupabaseConfigured();
}
