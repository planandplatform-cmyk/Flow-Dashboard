import { describe, expect, it } from "vitest";
import { buildManualBatch } from "./manual";

const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
const july = { periodStart: "2026-07-01", periodEnd: "2026-07-31" };

describe("manual entry", () => {
  it("saves a total as a period value", () => {
    const r = buildManualBatch(form({ mode: "metric", metric: "ads_reach", value: "13,020", ...july }));
    expect("batch" in r && r.batch.period).toEqual([
      { source: "meta_ads", metric_key: "ads_reach", period_start: "2026-07-01", period_end: "2026-07-31", dimension: "", dimension_value: "", value: 13020 },
    ]);
  });

  it("saves follower counts as the reading on the end date", () => {
    const r = buildManualBatch(form({ mode: "metric", metric: "li_followers", value: "812", ...july }));
    expect("batch" in r && r.batch.daily[0]).toMatchObject({ metric_key: "li_followers", date: "2026-07-31", value: 812 });
  });

  it("rejects rates, negatives and bad breakdowns", () => {
    expect(buildManualBatch(form({ mode: "metric", metric: "ads_ctr", value: "2", ...july }))).toHaveProperty("error");
    expect(buildManualBatch(form({ mode: "metric", metric: "fb_views", value: "-5", ...july }))).toHaveProperty("error");
    expect(buildManualBatch(form({ mode: "metric", metric: "fb_net_new_followers", value: "-5", ...july }))).toHaveProperty("batch");
    expect(buildManualBatch(form({ mode: "metric", metric: "fb_views", value: "5", dimension: "channel", dimensionValue: "x", ...july }))).toHaveProperty("error");
    expect(buildManualBatch(form({ mode: "metric", metric: "fb_views", value: "5", periodStart: "2026-07-31", periodEnd: "2026-07-01" }))).toHaveProperty("error");
  });

  it("saves an age breakdown as shares, skipping blank rows", () => {
    const r = buildManualBatch(
      form({ mode: "breakdown", platform: "meta_instagram", breakdownType: "age", bucket: ["25-34", "35-44", "45-54"], share: ["37.5", "26.3", ""], ...july }),
    );
    expect("error" in r).toBe(false);
    if ("error" in r) return;
    expect(r.batch.snapshots).toHaveLength(2);
    expect(r.batch.snapshots[0]).toMatchObject({ bucket: "25-34", share: 0.375, snapshot_date: "2026-07-31", period_start: null });
  });

  it("dates discovery mixes to the period and rejects totals over 100%", () => {
    const ok = buildManualBatch(form({ mode: "breakdown", platform: "meta_facebook", breakdownType: "discovery_surface", bucket: ["Feed", "Reels"], share: ["58", "36.4"], ...july }));
    expect("batch" in ok && ok.batch.snapshots[0].period_start).toBe("2026-07-01");
    const over = buildManualBatch(form({ mode: "breakdown", platform: "meta_facebook", breakdownType: "gender", bucket: ["Men", "Women"], share: ["60", "60"], ...july }));
    expect(over).toEqual({ error: "The percentages add up to 120.0%, more than 100%." });
  });
});
