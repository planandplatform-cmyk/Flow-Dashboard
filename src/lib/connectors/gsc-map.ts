/**
 * Search Console (Google Search) reports for one site, and how their rows
 * become portal metrics. Pure (no network), so the mapping is unit tested.
 *
 * Daily: clicks, impressions and position for the whole site, so any date
 * range is exact. Monthly: the top search terms and pages, which would be too
 * many rows by day. Position is stored as position x impressions so it can be
 * averaged correctly over any range (the way Search Console does).
 */
import type { DailyIn, PeriodIn } from "@/lib/ingest/types";
import { monthRange, monthsBetween } from "@/lib/dates";
import type { DateRange } from "@/lib/metrics/aggregate";

export interface GscRequest {
  id: "daily" | "month-queries" | "month-pages";
  period?: DateRange;
  body: { startDate: string; endDate: string; dimensions: string[]; rowLimit: number; type: "web" };
}

export interface GscResponse {
  rows?: { keys?: string[]; clicks: number; impressions: number; ctr: number; position: number }[];
}

const TOP_QUERIES = 100;
const TOP_PAGES = 50;

export function gscRequests(range: DateRange): GscRequest[] {
  const requests: GscRequest[] = [
    { id: "daily", body: { startDate: range.start, endDate: range.end, dimensions: ["date"], rowLimit: 25000, type: "web" } },
  ];
  for (const month of monthsBetween(range.start, range.end)) {
    const full = monthRange(month);
    const period = { start: full.start, end: full.end < range.end ? full.end : range.end };
    // Search Console sorts by clicks, so the row limit keeps the top ones.
    requests.push(
      { id: "month-queries", period, body: { startDate: period.start, endDate: period.end, dimensions: ["query"], rowLimit: TOP_QUERIES, type: "web" } },
      { id: "month-pages", period, body: { startDate: period.start, endDate: period.end, dimensions: ["page"], rowLimit: TOP_PAGES, type: "web" } },
    );
  }
  return requests;
}

/** Full page address to its path, the way the website section shows pages. */
function pagePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function mapGscReport(req: GscRequest, res: GscResponse): { daily: DailyIn[]; period: PeriodIn[] } {
  const daily: DailyIn[] = [];
  const period: PeriodIn[] = [];
  for (const row of res.rows ?? []) {
    const key = row.keys?.[0] ?? "";
    if (!key) continue;
    const values: [string, number][] = [
      ["gsc_clicks", row.clicks],
      ["gsc_impressions", row.impressions],
      ["gsc_position_weighted", Math.round(row.position * row.impressions * 100) / 100],
    ];
    for (const [metric_key, value] of values) {
      if (!Number.isFinite(value)) continue;
      if (req.id === "daily") {
        daily.push({ source: "search_console", metric_key, date: key, value, dimension: "", dimension_value: "" });
      } else if (req.period) {
        const dimension = req.id === "month-queries" ? "query" : "page";
        const dimension_value = (dimension === "page" ? pagePath(key) : key).slice(0, 200);
        period.push({ source: "search_console", metric_key, period_start: req.period.start, period_end: req.period.end, value, dimension, dimension_value });
      }
    }
  }
  return { daily, period };
}

/**
 * What was pasted, as Search Console names the site: "sc-domain:example.com"
 * for a domain property, or the full address with a trailing slash for a
 * URL-prefix property. A bare domain is taken as a domain property.
 */
export function parseSiteUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^sc-domain:/i.test(v)) {
    const host = v.slice(10).trim().toLowerCase();
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? `sc-domain:${host}` : null;
  }
  if (/^https?:\/\//i.test(v)) {
    try {
      const u = new URL(v);
      return `${u.origin}${u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`}`;
    } catch {
      return null;
    }
  }
  const host = v.replace(/\/+$/, "").toLowerCase();
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? `sc-domain:${host.replace(/^www\./, "")}` : null;
}

export function gscErrorMessage(status: number, message: string, serviceEmail: string | null, shared: string[]): string {
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return "The Google Search Console API is not turned on in the Google Cloud project. Turn it on (APIs & Services, Library, Google Search Console API) and try again.";
  }
  if (status === 403 || status === 404) {
    const list = shared.length ? ` Sites shared with the portal so far: ${shared.join(", ")}.` : "";
    return `The portal cannot see this site in Search Console. In Search Console, Settings, Users and permissions, add ${serviceEmail ?? "the service account email"} as a user, and check the site matches exactly (a domain property looks like sc-domain:example.com).${list}`;
  }
  if (status === 429) return "Google's limit for Search Console was reached. The next nightly sync will catch up.";
  return `Search Console returned an error (${status}): ${message}`;
}
