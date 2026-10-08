import { describe, expect, it } from "vitest";
import { MetricResolver } from "@/lib/metrics/aggregate";
import { buildSocialGrowth, buildTrends, metricDependencies, trendFetchRange, trendMonths } from "./trends";

describe("trend months", () => {
  it("covers 12 months ending with the range's month", () => {
    const m = trendMonths({ start: "2026-07-01", end: "2026-07-31" });
    expect(m).toHaveLength(12);
    expect(m[0]).toBe("2025-08-01");
    expect(m.at(-1)).toBe("2026-07-01");
    expect(trendFetchRange(m)).toEqual({ start: "2024-08-01", end: "2026-07-31" });
  });

  it("stretches to cover a longer range, up to 24 months", () => {
    expect(trendMonths({ start: "2025-01-01", end: "2026-06-30" })).toHaveLength(18);
    expect(trendMonths({ start: "2023-01-01", end: "2026-06-30" })).toHaveLength(24);
  });
});

describe("metricDependencies", () => {
  it("includes ratio and derived components", () => {
    const deps = metricDependencies(["ga4_engagement_rate", "total_followers"]);
    expect(deps).toEqual(expect.arrayContaining(["ga4_engaged_sessions", "ga4_sessions", "fb_followers", "ig_followers"]));
  });
});

describe("buildTrends", () => {
  const resolver = new MetricResolver({
    daily: [
      { metric_key: "ga4_sessions", date: "2026-05-03", value: 100 },
      { metric_key: "ga4_sessions", date: "2026-06-03", value: 120 },
      { metric_key: "ga4_sessions", date: "2025-06-10", value: 80 },
      { metric_key: "ga4_engaged_sessions", date: "2026-06-03", value: 60 },
      { metric_key: "ga4_sessions", date: "2026-07-02", value: 10 },
    ],
    period: [],
  });

  it("rolls each month up and pairs it with the year before", () => {
    const [s] = buildTrends(resolver, ["ga4_sessions", "ga4_engagement_rate"], ["2026-05-01", "2026-06-01", "2026-07-01"], "2026-07-05");
    expect(s.key).toBe("ga4_sessions");
    expect(s.points.map((p) => p.value)).toEqual([100, 120, 10]);
    expect(s.points.map((p) => p.previous)).toEqual([null, 80, null]);
    expect(s.points.map((p) => p.partial)).toEqual([false, false, true]);
    expect(s.points[1].label).toBe("Jun '26");
  });

  it("leaves out metrics with fewer than two months of data", () => {
    const keys = buildTrends(resolver, ["ga4_sessions", "ga4_engagement_rate"], ["2026-05-01", "2026-06-01"], "2026-10-01").map((s) => s.key);
    expect(keys).toEqual(["ga4_sessions"]);
  });
});

describe("combined social growth", () => {
  const resolver = new MetricResolver({
    daily: [
      { metric_key: "fb_views", date: "2026-06-03", value: 100 },
      { metric_key: "fb_views", date: "2026-07-03", value: 150 },
      { metric_key: "ig_views", date: "2026-06-03", value: 40 },
      { metric_key: "ig_views", date: "2026-07-03", value: 60 },
      { metric_key: "li_impressions", date: "2026-06-03", value: 500 },
      { metric_key: "li_impressions", date: "2026-07-03", value: 700 },
    ],
    period: [],
  });
  const prefix = { meta_facebook: "fb", meta_instagram: "ig", linkedin: "li" } as const;
  const platform = (source: "meta_facebook" | "meta_instagram" | "linkedin", views: string) => ({
    source,
    label: source,
    keys: { followers: `${prefix[source]}_followers`, netNew: `${prefix[source]}_net_new_followers`, views, interactions: `${prefix[source]}_interactions` },
  });
  const growth = buildSocialGrowth(
    resolver,
    [platform("meta_facebook", "fb_views"), platform("meta_instagram", "ig_views"), platform("linkedin", "li_impressions")],
    ["2026-06-01", "2026-07-01"],
    "2026-10-08",
  );

  it("draws each platform and totals views without LinkedIn impressions", () => {
    const views = growth.find((g) => g.id === "views")!;
    expect(views.lines.map((l) => l.source)).toEqual(["meta_facebook", "meta_instagram", "linkedin"]);
    expect(views.points.map((p) => p.total)).toEqual([140, 210]);
    expect(views.points[1].linkedin).toBe(700);
    expect(views.note).toContain("LinkedIn");
  });

  it("leaves out measures with no data", () => {
    expect(growth.map((g) => g.id)).toEqual(["views"]);
  });
});
