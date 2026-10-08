/**
 * GA4 Data API reports for one client, and how their rows become portal
 * metrics. Pure (no network), so the mapping is unit tested.
 *
 * Daily: totals and sessions by channel, so any date range is exact.
 * Monthly: visitors (unique, so only correct for the exact month), visitors
 * by channel, and the top landing pages and pages, which would be too many
 * rows by day.
 */
import type { DailyIn, PeriodIn } from "@/lib/ingest/types";
import { monthRange, monthsBetween } from "@/lib/dates";
import type { DateRange } from "@/lib/metrics/aggregate";

export interface Ga4ReportRequest {
  id: string;
  /** Monthly reports carry the month they cover. */
  period?: DateRange;
  body: {
    dateRanges: { startDate: string; endDate: string }[];
    dimensions: { name: string }[];
    metrics: { name: string }[];
    limit?: number;
    orderBys?: { metric: { metricName: string }; desc: boolean }[];
  };
}

export interface Ga4ReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

/** GA4 metric name to portal metric key. */
const METRIC_KEYS: Record<string, string> = {
  sessions: "ga4_sessions",
  engagedSessions: "ga4_engaged_sessions",
  keyEvents: "ga4_key_events",
  screenPageViews: "ga4_page_views",
  totalUsers: "ga4_users",
};

const TOP = 50;

/** Every report needed to fill a date range (complete days only; the caller clips the end). */
export function ga4Requests(range: DateRange): Ga4ReportRequest[] {
  const dr = (r: DateRange) => [{ startDate: r.start, endDate: r.end }];
  const m = (...names: string[]) => names.map((name) => ({ name }));
  const requests: Ga4ReportRequest[] = [
    {
      id: "daily",
      body: { dateRanges: dr(range), dimensions: m("date"), metrics: m("sessions", "engagedSessions", "keyEvents", "screenPageViews", "totalUsers"), limit: 100000 },
    },
    {
      id: "daily-channel",
      body: { dateRanges: dr(range), dimensions: m("date", "sessionDefaultChannelGroup"), metrics: m("sessions", "engagedSessions", "keyEvents"), limit: 100000 },
    },
  ];
  // Every month the range touches, as a whole month (to the range end at most),
  // so visitors are exact for the month view.
  for (const month of monthsBetween(range.start, range.end)) {
    const full = monthRange(month);
    const period = { start: full.start, end: full.end < range.end ? full.end : range.end };
    const by = (metric: string) => [{ metric: { metricName: metric }, desc: true }];
    requests.push(
      { id: "month-users", period, body: { dateRanges: dr(period), dimensions: [], metrics: m("totalUsers") } },
      { id: "month-channel-users", period, body: { dateRanges: dr(period), dimensions: m("sessionDefaultChannelGroup"), metrics: m("totalUsers") } },
      {
        id: "month-landing",
        period,
        body: { dateRanges: dr(period), dimensions: m("landingPage"), metrics: m("sessions", "engagedSessions", "keyEvents", "totalUsers"), limit: TOP, orderBys: by("sessions") },
      },
      { id: "month-pages", period, body: { dateRanges: dr(period), dimensions: m("pagePath"), metrics: m("screenPageViews"), limit: TOP, orderBys: by("screenPageViews") } },
    );
  }
  return requests;
}

const isoDate = (yyyymmdd: string) => `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** Turn one report's rows into portal rows. */
export function mapGa4Report(req: Ga4ReportRequest, res: Ga4ReportResponse): { daily: DailyIn[]; period: PeriodIn[] } {
  const dims = (res.dimensionHeaders ?? []).map((h) => h.name);
  const mets = (res.metricHeaders ?? []).map((h) => h.name);
  const daily: DailyIn[] = [];
  const period: PeriodIn[] = [];
  for (const row of res.rows ?? []) {
    const d = Object.fromEntries(dims.map((name, i) => [name, row.dimensionValues[i]?.value ?? ""]));
    let dimension = "";
    let dimensionValue = "";
    if (d.sessionDefaultChannelGroup !== undefined) [dimension, dimensionValue] = ["channel", d.sessionDefaultChannelGroup];
    if (d.landingPage !== undefined) [dimension, dimensionValue] = ["landing_page", d.landingPage];
    if (d.pagePath !== undefined) [dimension, dimensionValue] = ["landing_page", d.pagePath];
    if (dimension && (!dimensionValue || dimensionValue === "(not set)")) continue;
    mets.forEach((name, i) => {
      const key = METRIC_KEYS[name];
      const value = Number(row.metricValues[i]?.value);
      if (!key || !Number.isFinite(value)) return;
      // Visitors are unique: only monthly reports give a correct total.
      if (key === "ga4_users" && req.id === "daily") {
        daily.push({ source: "ga4", metric_key: key, date: isoDate(d.date), value, dimension: "", dimension_value: "" });
        return;
      }
      if (d.date !== undefined) daily.push({ source: "ga4", metric_key: key, date: isoDate(d.date), value, dimension, dimension_value: dimensionValue.slice(0, 200) });
      else if (req.period) {
        period.push({
          source: "ga4",
          metric_key: key,
          period_start: req.period.start,
          period_end: req.period.end,
          value,
          dimension,
          dimension_value: dimensionValue.slice(0, 200),
        });
      }
    });
  }
  return { daily, period };
}

/** Plain-English reason for a GA4 API error. */
export function ga4ErrorMessage(status: number, message: string, serviceEmail: string | null): string {
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(message)) {
    return "The Google Analytics Data API is not turned on in the Google Cloud project. Turn it on (APIs & Services, Library, Google Analytics Data API) and try again.";
  }
  if (status === 403) {
    return `The service account cannot see this GA4 property. In GA4, Admin, Property access management, add ${serviceEmail ?? "the service account email"} as a Viewer.`;
  }
  if (status === 404 || /property/i.test(message) && status === 400) {
    return "That GA4 property ID was not found. Use the numeric Property ID from GA4 Admin, Property details (for example 412345678), not the G- measurement ID.";
  }
  if (status === 429) return "Google's hourly limit for this property was reached. The next nightly sync will catch up.";
  return `Google Analytics returned an error (${status}): ${message}`;
}
