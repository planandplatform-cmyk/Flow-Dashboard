import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode, isSupabaseConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseConfigProblem } from "@/lib/supabase/env";

const PUBLIC_PATHS = ["/login", "/auth/"];

/**
 * Refreshes the Supabase session cookie on every request and sends signed-out
 * visitors to the login page. This is a convenience redirect only: data access
 * is enforced by row-level security in the database.
 */
export async function proxy(request: NextRequest) {
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
