import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode, isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigProblem } from "@/lib/supabase/env";

// The cron route checks its own secret (CRON_SECRET), it has no user session.
const PUBLIC_PATHS = ["/login", "/auth/", "/api/cron/"];

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out
 * visitors to the login page. This is a convenience redirect only: data access
 * is enforced by row-level security in the database.
 */
/**
 * In production, any address other than SITE_URL (the long deployment links,
 * the team address) is sent to SITE_URL. Those addresses sit behind Vercel's
 * login, so links built on them fail for clients and on phones.
 */
export function canonicalRedirect(request: NextRequest): NextResponse | null {
  if (process.env.VERCEL_ENV !== "production" || !process.env.SITE_URL) return null;
  // Scheduled jobs call the deployment directly; leave API routes alone.
  if (request.nextUrl.pathname.startsWith("/api/")) return null;
  let site: URL;
  try {
    site = new URL(process.env.SITE_URL.trim());
  } catch {
    return null;
  }
  const host = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
  if (!host || host === site.host) return null;
  return NextResponse.redirect(new URL(request.nextUrl.pathname + request.nextUrl.search, site.origin), 308);
}

export async function proxy(request: NextRequest) {
  const canonical = canonicalRedirect(request);
  if (canonical) return canonical;
  if (isDemoMode()) return NextResponse.next();
  if (!isSupabaseConfigured()) {
    // Shown instead of a bare 500 so a settings typo is easy to spot. Says
    // which variable is wrong, never its value.
    return new NextResponse(
      `The portal is not connected to Supabase yet.\n\n${supabaseConfigProblem()}\n\nFix it in Vercel (Settings, Environment Variables), then redeploy.`,
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
      },
    },
  });

  // getClaims verifies the JWT; do not trust getSession() on the server.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;

  if (!signedIn && !PUBLIC_PATHS.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = path === "/" ? "" : `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|brand/|icon.svg|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)"],
};
