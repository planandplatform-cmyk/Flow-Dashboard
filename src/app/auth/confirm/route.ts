import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = ["email", "magiclink", "invite", "signup", "recovery", "email_change"];

/** Only allow redirects to paths on this site. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Email link landing page. Links in emails are one-time, and many business
 * mail systems (Microsoft 365, Google Workspace, security filters) open every
 * link to scan it before the person does, which would use the link up. So a
 * GET only shows a "Continue" button; the sign-in happens on the POST that a
 * real click sends, which scanners do not do.
 *
 * Also accepts the PKCE code format (same browser that asked for the link).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(new URL(error ? "/login?error=link" : next, origin));
  }
  if (!tokenHash || !type || !OTP_TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/login?error=link", origin));
  }

  const action = type === "invite" || type === "signup" ? "Accept invite" : "Sign in";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${action} | Flow Forward Media</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: #000; color: #fff;
         font-family: Inter, ui-sans-serif, system-ui, sans-serif; padding: 16px; }
  main { width: 100%; max-width: 360px; text-align: center; }
  img { height: 48px; width: auto; }
  h1 { font-size: 22px; margin: 32px 0 8px; }
  p { color: #a3a3a3; font-size: 14px; line-height: 1.5; margin: 0 0 28px; }
  button { width: 100%; padding: 14px 16px; border: 0; border-radius: 10px; background: #31e4e4; color: #000;
           font-size: 16px; font-weight: 600; cursor: pointer; }
  button:hover { background: #8cf0f0; }
  button:focus-visible { outline: 2px solid #31e4e4; outline-offset: 3px; }
</style>
</head>
<body>
<main>
  <img src="/brand/ffm-logo.png" alt="Flow Forward Media">
  <h1>${action}</h1>
  <p>Press the button to finish signing in to your client performance portal.</p>
  <form method="post" action="/auth/confirm">
    <input type="hidden" name="token_hash" value="${escape(tokenHash)}">
    <input type="hidden" name="type" value="${escape(type)}">
    <input type="hidden" name="next" value="${escape(next)}">
    <button type="submit" autofocus>${action}</button>
  </form>
</main>
</body>
</html>`;
  return new NextResponse(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
    },
  });
}

export async function POST(request: NextRequest) {
  const { origin } = request.nextUrl;
  // Only accept the form from this site's own "Continue" page.
  const from = request.headers.get("origin");
  if (from && from !== origin) {
    return NextResponse.redirect(new URL("/login?error=link", origin), { status: 303 });
  }
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const next = safeNext(String(form.get("next") ?? "/"));

  if (!tokenHash || !OTP_TYPES.includes(type)) {
    return NextResponse.redirect(new URL("/login?error=link", origin), { status: 303 });
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return NextResponse.redirect(new URL(error ? "/login?error=link" : next, origin), { status: 303 });
}
