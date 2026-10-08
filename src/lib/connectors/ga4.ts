import "server-only";
import { googleAccessToken, serviceAccount } from "./google-auth";
import { ga4ErrorMessage, type Ga4ReportRequest, type Ga4ReportResponse } from "./ga4-map";

/** Read-only: the portal can never change anything in Google Analytics. */
export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export class Ga4Error extends Error {}

/** Run one GA4 Data API report for a property (numeric ID). */
export async function runGa4Report(propertyId: string, req: Ga4ReportRequest): Promise<Ga4ReportResponse> {
  const token = await googleAccessToken(GA4_SCOPE);
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(req.body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Ga4ReportResponse & { error?: { message?: string } };
  if (!res.ok) throw new Ga4Error(ga4ErrorMessage(res.status, json.error?.message ?? res.statusText, serviceAccount()?.client_email ?? null));
  return json;
}

/** A tiny report, to confirm the property ID and access before a full pull. */
export async function checkGa4Property(propertyId: string): Promise<void> {
  await runGa4Report(propertyId, {
    id: "check",
    body: { dateRanges: [{ startDate: "7daysAgo", endDate: "yesterday" }], dimensions: [], metrics: [{ name: "sessions" }] },
  });
}
