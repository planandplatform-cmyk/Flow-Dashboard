import "server-only";
import { googleAccessToken, serviceAccount } from "./google-auth";
import { gscErrorMessage, type GscRequest, type GscResponse } from "./gsc-map";

/** Read-only: the portal can never change anything in Search Console. */
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export class GscError extends Error {}

async function call(path: string, init?: RequestInit) {
  const token = await googleAccessToken(GSC_SCOPE);
  const res = await fetch(`https://searchconsole.googleapis.com/webmasters/v3/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  return { res, json };
}

/** Sites the service account has been added to, to point out a mismatch. */
export async function sharedSites(): Promise<string[]> {
  const { res, json } = await call("sites");
  if (!res.ok) return [];
  return ((json.siteEntry as { siteUrl: string }[] | undefined) ?? []).map((s) => s.siteUrl);
}

export async function runGscReport(siteUrl: string, req: GscRequest): Promise<GscResponse> {
  const { res, json } = await call(`sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, { method: "POST", body: JSON.stringify(req.body) });
  if (!res.ok) {
    const message = json.error?.message ?? res.statusText;
    const shared = res.status === 403 || res.status === 404 ? await sharedSites() : [];
    throw new GscError(gscErrorMessage(res.status, message, serviceAccount()?.client_email ?? null, shared));
  }
  return json as GscResponse;
}

/** A tiny query, to confirm the site and access before a full pull. */
export async function checkGscSite(siteUrl: string): Promise<void> {
  const end = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  await runGscReport(siteUrl, { id: "daily", body: { startDate: start, endDate: end, dimensions: ["date"], rowLimit: 1, type: "web" } });
}
