import { describe, expect, it } from "vitest";
import fixture from "@/lib/demo/fixture.json";
import { compare, MetricResolver, type DailyRow } from "./aggregate";
import { METRICS } from "./config";
import { GLOSSARY } from "./glossary";
import { formatMetric, formatPctChange } from "./format";
import { adRowsToDaily } from "@/lib/data/ads";

const JULY = { start: "2026-07-01", end: "2026-07-31" };
const JUNE = { start: "2026-06-01", end: "2026-06-30" };
const CAMPAIGN = { start: "2026-07-14", end: "2026-08-06" };

const resolver = new MetricResolver({
  daily: [...(fixture.metricsDaily as DailyRow[]), ...adRowsToDaily(fixture.adMetricsDaily)],
  period: fixture.metricsPeriod,
});
const v = (key: string, range = JULY) => resolver.resolve(key, range).value;

describe("Wieler Roofing seed reproduces the July 2026 report", () => {
  it("social overview", () => {
    expect(v("fb_followers")).toBe(51);
    expect(v("fb_net_new_followers")).toBe(3);
    expect(v("fb_views")).toBe(21239);
    expect(v("fb_interactions")).toBe(362);
    expect(v("ig_followers")).toBe(213);
    expect(v("ig_net_new_followers")).toBe(8);
    expect(v("ig_views")).toBe(2254);
    expect(v("ig_interactions")).toBe(94);
    expect(v("total_followers")).toBe(264);
    expect(v("total_net_new_followers")).toBe(11);
    expect(v("total_audience_reach")).toBe(23493);
    expect(v("total_interactions")).toBe(456);
  });

  it("platform tiles", () => {
    expect(v("fb_reactions")).toBe(52);
    expect(v("fb_page_visits")).toBe(155);
    expect(v("ig_reels_views")).toBe(1400);
    expect(v("ig_profile_visits")).toBe(52);
    expect(v("ig_reels_interactions")).toBe(41);
  });

  it("website", () => {
    expect(v("ga4_sessions")).toBe(430);
    expect(formatMetric("ga4_engagement_rate", v("ga4_engagement_rate"))).toBe("98.6%");
    const paidSocial = resolver.resolve("ga4_engagement_rate", JULY, { dimension: "channel", value: "Paid Social" });
    expect(formatMetric("ga4_engagement_rate", paidSocial.value)).toBe("98.7%");
    const pages = resolver.breakdown("ga4_page_views", "landing_page", JULY);
    expect(pages[0]).toEqual({ bucket: "/roof-inspection", value: 387 });
    expect(resolver.resolve("ga4_key_events", JULY, { dimension: "landing_page", value: "/roof-inspection" }).value).toBe(379);
  });

  it("Meta ads over the campaign window", () => {
    expect(v("ads_leads", CAMPAIGN)).toBe(23);
    expect(formatMetric("ads_spend", v("ads_spend", CAMPAIGN))).toBe("$719.19");
    expect(v("ads_reach", CAMPAIGN)).toBe(13020);
    expect(resolver.resolve("ads_reach", CAMPAIGN).estimated).toBe(false);
    expect(formatMetric("ads_frequency", v("ads_frequency", CAMPAIGN))).toBe("2.19x");
    expect(formatMetric("ads_ctr", v("ads_ctr", CAMPAIGN))).toBe("2.18%");
    expect(v("ads_ctr", CAMPAIGN)).toBeCloseTo(0.0218, 4);
    expect(formatMetric("ads_cpl", v("ads_cpl", CAMPAIGN))).toBe("$31.27");
  });

  it("month over month", () => {
    const fbViews = compare("fb_views", v("fb_views"), v("fb_views", JUNE));
    expect(formatPctChange(fbViews.pctChange)).toBe("+5,800%");
    expect(fbViews.sentiment).toBe("positive");
    const fbEng = compare("fb_interactions", v("fb_interactions"), v("fb_interactions", JUNE));
    expect(formatPctChange(fbEng.pctChange)).toBe("+2,486%");
    const igFollowers = compare("ig_followers", v("ig_followers"), v("ig_followers", JUNE));
    expect(formatPctChange(igFollowers.pctChange)).toBe("+3.9%");
  });
});

describe("aggregation rules", () => {
  const daily: DailyRow[] = [
    { metric_key: "ga4_sessions", date: "2026-01-01", value: 100 },
    { metric_key: "ga4_engaged_sessions", date: "2026-01-01", value: 90 },
    { metric_key: "ga4_sessions", date: "2026-01-02", value: 1 },
    { metric_key: "ga4_engaged_sessions", date: "2026-01-02", value: 0 },
    { metric_key: "ads_reach", date: "2026-01-01", value: 50 },
    { metric_key: "ads_reach", date: "2026-01-02", value: 50 },
  ];
  const r = new MetricResolver({ daily, period: [{ metric_key: "ads_reach", period_start: "2026-01-01", period_end: "2026-01-01", value: 50 }] });
  const range = { start: "2026-01-01", end: "2026-01-02" };

  it("recomputes ratios from components instead of averaging daily ratios", () => {
    // Average of daily rates would be (0.9 + 0) / 2 = 45%. Correct is 90/101.
    expect(r.resolve("ga4_engagement_rate", range).value).toBeCloseTo(90 / 101, 10);
  });

  it("uses exact period values for unique metrics and flags estimates otherwise", () => {
    expect(r.resolve("ads_reach", { start: "2026-01-01", end: "2026-01-01" })).toEqual({ value: 50, estimated: false });
    expect(r.resolve("ads_reach", range)).toEqual({ value: 100, estimated: true });
  });

  it("returns null rather than zero when there is no data", () => {
    expect(r.resolve("fb_views", range).value).toBeNull();
    expect(r.resolve("ads_cpl", range).value).toBeNull();
  });

  it("treats a cost going up as bad news", () => {
    expect(compare("ads_cpl", 40, 30).sentiment).toBe("negative");
    expect(compare("ads_leads", 40, 30).sentiment).toBe("positive");
  });
});

describe("metric config", () => {
  const keys = Object.keys(METRICS);
  const glossaryIds = new Set(GLOSSARY.map((g) => g.id));

  it("ratio and derived components exist", () => {
    for (const def of Object.values(METRICS)) {
      const a = def.aggregation;
      const refs = a.type === "ratio" ? [a.numerator, a.denominator] : a.type === "derived_sum" ? a.of : [];
      for (const ref of refs) expect(keys, `${def.key} -> ${ref}`).toContain(ref);
    }
  });

  it("glossary terms exist", () => {
    for (const def of Object.values(METRICS)) {
      if (def.glossaryTerm) expect(glossaryIds.has(def.glossaryTerm), def.key).toBe(true);
    }
  });

  it("client-facing copy has no em dashes", () => {
    for (const def of Object.values(METRICS)) {
      expect(def.label + def.definition, def.key).not.toMatch(/—/);
    }
    for (const g of GLOSSARY) expect(g.term + g.definition).not.toMatch(/—/);
    expect(JSON.stringify(fixture.commentary)).not.toMatch(/—/);
  });
});

describe("formatting", () => {
  it("shows rate changes as percentage points", async () => {
    const { formatDelta } = await import("./format");
    expect(formatDelta("ga4_engagement_rate", 0.367)).toBe("+36.7 pts");
    expect(formatDelta("ads_ctr", -0.0021)).toBe("-0.21 pts");
    expect(formatDelta("ads_spend", 12.5)).toBe("+$12.50");
  });
});
