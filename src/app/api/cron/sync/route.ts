import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/connectors/cron-auth";
import { googleConfigured } from "@/lib/connectors/google-auth";
import { syncAllGa4 } from "@/lib/connectors/run";
import { adminApiConfigured } from "@/lib/supabase/admin";

export const maxDuration = 300;

/**
 * Nightly pull of automatic data (vercel.json schedules it). Vercel sends
 * CRON_SECRET as a bearer token; anything else gets a 401.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!googleConfigured() || !adminApiConfigured()) {
    return NextResponse.json({ skipped: "GOOGLE_SERVICE_ACCOUNT_KEY or SUPABASE_SECRET_KEY is not set" });
  }
  const results = await syncAllGa4();
  return NextResponse.json(
    { clients: results.length, failed: results.filter((r) => !r.ok).length, results },
    { headers: { "cache-control": "no-store" } },
  );
}
