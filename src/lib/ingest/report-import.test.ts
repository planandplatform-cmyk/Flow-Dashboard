import { describe, expect, it, vi } from "vitest";
import { reportSchema, reviewReport, splitReport, type ReportExtraction } from "./report-import";
import { buildScreenshotResult } from "./screenshot";

// From FFM's MCWL Paladin Geological August 2026 report (GA4 and LinkedIn).
const august = { start: "2026-08-01", end: "2026-08-31" };
const m = (key: string, value: number, page: number, value_text = value.toLocaleString("en-US")) => ({
  key,
  value,
  value_text,
  label_seen: key,
  page,
  confidence: "high" as const,
});
const extraction: ReportExtraction = {
  is_report: true,
  date_range: { start: "2026-08-01", end: "2026-08-31", label: "August 1–31, 2026" },
  metrics: [
    m("ga4_users", 726, 3),
    m("ga4_sessions", 801, 3),
    m("ga4_engaged_sessions", 226, 3),
    m("ga4_page_views", 1131, 3),
    m("ga4_key_events", 0, 3),
    m("li_impressions", 18335, 9),
    m("li_reactions", 229, 9),
    m("li_comments", 11, 9),
    m("li_reposts", 1, 9),
    m("li_page_views", 264, 9),
    m("li_unique_visitors", 116, 9),
    m("li_button_clicks", 6, 9),
    m("li_net_new_followers", 166, 10),
    m("li_followers", 2039, 10),
  ],
  table_rows: [
    { key: "ga4_sessions", dimension: "channel", bucket: "Direct", value: 553, page: 4 },
    { key: "ga4_sessions", dimension: "channel", bucket: "Organic Search", value: 204, page: 4 },
    { key: "ga4_sessions", dimension: "landing_page", bucket: "/careers", value: 38, page: 4 },
  ],
  breakdowns: [
    { platform: "ga4", type: "country", bucket: "United States", percent: 62.26, page: 6, confidence: "high" },
    { platform: "linkedin", type: "industry", bucket: "Oil and Gas", percent: 46, page: 11, confidence: "high" },
  ],
  competitors: [
    { company: "Diversified Energy Company", is_your_page: false, metric: "engagements", value: 1301, value_text: "1,301", change_percent: 11.8, page: 12, confidence: "high" },
    { company: "MCWL Paladin Geological", is_your_page: true, metric: "engagements", value: 241, value_text: "241", change_percent: 88.3, page: 12, confidence: "high" },
  ],
  commentary: {
    headline: "LinkedIn organic impressions reached 18,335 in August, up 61.9% against the prior period.",
    summary: "This report covers website performance and LinkedIn company page performance.",
    conclusion: "In August 2026, the website recorded 726 active users across 801 sessions.",
  },
  notes: [],
};

describe("importing a full report", () => {
  const review = reviewReport(extraction, ["ga4", "linkedin"], undefined);

  it("files every number under its platform for the report's month", () => {
    expect(review.errors).toEqual([]);
    expect(review.period).toEqual(august);
    expect(review.items.filter((i) => i.source === "ga4").map((i) => i.key)).toEqual([
      "ga4_users",
      "ga4_sessions",
      "ga4_engaged_sessions",
      "ga4_page_views",
      "ga4_key_events",
    ]);
    expect(review.items.filter((i) => i.source === "linkedin")).toHaveLength(9);
    expect(review.items[0].imageIndex).toBe(3); // page number shown in review
    expect(review.competitors.map((c) => [c.company, c.own])).toEqual([
      ["Diversified Energy Company", false],
      ["MCWL Paladin Geological", true],
    ]);
  });

  it("splits into one save per platform, with website tables and LinkedIn competitors", () => {
    const parts = splitReport({
      period: august,
      metrics: review.items.map((i) => ({ source: i.source, key: i.key, value: i.value })),
      tableRows: review.tableRows,
      breakdowns: review.breakdowns.map((b) => ({ platform: b.platform, type: b.type, bucket: b.bucket, percent: b.percent })),
      competitors: review.competitors,
      commentary: null,
    });
    expect(parts.map((p) => p.platform)).toEqual(["ga4", "linkedin"]);

    const ga4 = buildScreenshotResult(parts[0]);
    expect(ga4.ok).toBe(true);
    if (ga4.ok) {
      const rows = ga4.batch.period.map((r) => [r.metric_key, r.dimension, r.dimension_value, r.value]);
      expect(rows).toContainEqual(["ga4_sessions", "", "", 801]);
      expect(rows).toContainEqual(["ga4_sessions", "channel", "Organic Search", 204]);
      expect(rows).toContainEqual(["ga4_sessions", "landing_page", "/careers", 38]);
      expect(ga4.batch.snapshots.map((s) => [s.platform, s.bucket])).toEqual([["ga4", "United States"]]);
    }

    const li = buildScreenshotResult(parts[1]);
    expect(li.ok).toBe(true);
    if (li.ok) {
      const rows = li.batch.period.map((r) => [r.metric_key, r.dimension_value, r.value]);
      // Reactions, comments and reposts add up to Interactions; clicks were not supplied.
      expect(rows).toContainEqual(["li_interactions", "", 241]);
      expect(rows).toContainEqual(["li_comp_engagements", "MCWL Paladin Geological", 241]);
      expect(li.warnings.join(" ")).toMatch(/missing: Clicks/);
    }
  });

  it("keeps users by channel (MCWL July) and leaves out tables it cannot store, without blocking", () => {
    const july = reviewReport(
      {
        ...extraction,
        date_range: { start: "2026-07-01", end: "2026-07-31", label: "July 1 to July 31, 2026" },
        table_rows: [
          { key: "ga4_users", dimension: "channel", bucket: "Direct", value: 544, page: 2 },
          { key: "ga4_users", dimension: "channel", bucket: "AI Assistant", value: 4, page: 2 },
          { key: "ga4_page_views", dimension: "channel", bucket: "Direct", value: 1, page: 2 },
        ],
      },
      ["ga4", "linkedin"],
      undefined,
    );
    expect(july.errors).toEqual([]);
    expect(july.tableRows.map((t) => [t.key, t.bucket, t.value])).toEqual([
      ["ga4_users", "Direct", 544],
      ["ga4_users", "AI Assistant", 4],
    ]);
    expect(july.warnings.join(" ")).toMatch(/Left out 1 table rows/);
    const [ga4] = splitReport({
      period: { start: "2026-07-01", end: "2026-07-31" },
      metrics: [],
      tableRows: july.tableRows,
      breakdowns: [],
      competitors: [],
      commentary: null,
    });
    const r = buildScreenshotResult(ga4);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("only allows the client's channels", () => {
    const schema = reportSchema(["ga4"]);
    const bad = { ...extraction, metrics: [m("li_impressions", 1, 1)] };
    expect(schema.safeParse(bad).success).toBe(false);
  });

  it("sends the PDF as a document with the report instructions", async () => {
    vi.resetModules();
    const parse = vi.fn().mockResolvedValue({ stop_reason: "end_turn", parsed_output: extraction });
    vi.doMock("server-only", () => ({}));
    vi.doMock("@anthropic-ai/sdk", async () => {
      const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
      class Fake {
        beta = { messages: { parse } };
      }
      return { ...actual, default: Object.assign(Fake, actual.default) };
    });
    const { readReport } = await import("./screenshot-reader");
    await readReport({ data: "JVBERi0", mediaType: "application/pdf" }, ["ga4", "linkedin"], "2026-10-08");
    const req = parse.mock.calls[0][0];
    expect(req.messages[0].content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(req.messages[0].content[1].text).toMatch(/Website, LinkedIn/);
    expect(req.system).toMatch(/word for word/);
    expect(req.max_tokens).toBeLessThanOrEqual(21000);
  });
});
