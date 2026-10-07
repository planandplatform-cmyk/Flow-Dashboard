import { describe, expect, it } from "vitest";
import { MetricResolver } from "@/lib/metrics/aggregate";
import { buildTrends, metricDependencies, trendFetchRange, trendMonths } from "./trends";

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
