import { describe, expect, it } from "vitest";
import { MetricResolver, type MetricData } from "@/lib/metrics/aggregate";
import { buildSocial } from "./social";

// The Sterling Carpet & Flooring July 2026 numbers from FFM's social report.
const p = (metric_key: string, period_start: string, period_end: string, value: number, dimension = "", dimension_value = "") => ({
  metric_key,
  period_start,
  period_end,
  value,
  dimension,
  dimension_value,
});
const data: MetricData = {
  daily: [{ metric_key: "ig_followers", date: "2026-07-30", value: 622 }],
  period: [
    p("ig_views", "2026-06-30", "2026-07-30", 12024),
    p("ig_viewers", "2026-06-30", "2026-07-30", 5159),
    p("ig_interactions", "2026-06-30", "2026-07-30", 499),
    p("ig_reels_interactions", "2026-06-30", "2026-07-30", 391),
    p("ig_post_interactions", "2026-06-30", "2026-07-30", 74),
    p("ig_net_new_followers", "2026-06-30", "2026-07-30", 27),
    p("fb_views", "2026-07-01", "2026-07-31", 4980),
    p("fb_views", "2026-06-01", "2026-06-30", 3921),
    p("li_page_views", "2026-07-01", "2026-07-31", 41),
    p("li_impressions", "2026-07-31", "2026-08-04", 202),
    p("li_comp_engagements", "2026-07-01", "2026-07-31", 2204, "competitor", "Diversified Energy Company"),
    p("li_comp_engagements", "2026-07-01", "2026-07-31", 244, "own_page", "MCWL Paladin Geological"),
    p("li_comp_engagements_change", "2026-07-01", "2026-07-31", 0.319, "own_page", "MCWL Paladin Geological"),
    p("li_comp_posts", "2026-07-01", "2026-07-31", 14, "own_page", "MCWL Paladin Geological"),
  ],
};
const range = { start: "2026-07-01", end: "2026-07-31" };
const social = buildSocial({
  resolver: new MetricResolver(data, { prorate: false }),
  data,
  range,
  compareRange: { start: "2026-06-01", end: "2026-06-30" },
  compareLabel: "June 2026",
  enabled: ["meta_facebook", "meta_instagram", "linkedin"],
  narratives: {},
  snapshots: [],
  postCounts: {},
});
const platform = (s: string) => social.platforms.find((x) => x.source === s)!;

describe("social sections", () => {
  it("keeps each platform's own numbers and source period", () => {
    const ig = platform("meta_instagram");
    expect(ig.sourcePeriod).toBe("Jun 30 to Jul 30, 2026");
    expect(ig.tiles.map((t) => [t.label, t.value])).toEqual([
      ["Views", "12,024"],
      ["Interactions", "499"],
      ["Net New Followers", "27"],
      ["Followers", "622"],
    ]);
    expect(ig.tiles[1].caption).toBe("Reels 391; Posts 74");
    expect(ig.tiles[2].caption).toBe("622 Followers at period end");
    expect(ig.missingNote).toBe("Reach, Profile Visits were not available in supplied data.");
  });

  it("shows a separately dated LinkedIn total with its own dates, never inside July", () => {
    const li = platform("linkedin");
    const imp = li.tiles.find((t) => t.key === "li_impressions")!;
    expect([imp.value, imp.caption, imp.comparison]).toEqual(["202", "Jul 31 to Aug 4, 2026 only", null]);
    expect(social.overview.find((o) => o.source === "linkedin")!.visibility).toBe("202 Impressions (Jul 31 to Aug 4, 2026); 41 Page Views");
    expect(social.limitations).toContain("LinkedIn Impressions cover Jul 31 to Aug 4, 2026, a separate period, so they are not compared or combined.");
  });

  it("combines only Views and says which platforms", () => {
    expect(social.combined).toMatchObject({ views: "17,004 Views", note: "Facebook and Instagram only" });
    expect(social.overview.find((o) => o.source === "meta_facebook")!.audience).toBe("Not available");
  });

  it("compares each platform only where a prior period was supplied", () => {
    const fb = social.compareCards.find((c) => c.source === "meta_facebook")!;
    expect(fb.headline?.text).toBe("+27%");
    expect(fb.lines.find((l) => l.label === "Engagement")!.text).toBe("Not available");
    const ig = social.compareCards.find((c) => c.source === "meta_instagram")!;
    expect(ig.headline).toBeNull();
  });

  it("ranks LinkedIn competitors and marks the client's page", () => {
    const t = social.competitors!;
    expect(t.columns.map((c) => c.metric)).toEqual(["posts", "engagements"]);
    expect(t.rows.map((r) => [r.rank, r.company, r.own])).toEqual([
      [1, "Diversified Energy Company", false],
      [2, "MCWL Paladin Geological", true],
    ]);
    expect(t.rows[1].cells.engagements).toEqual({ value: "244", change: 0.319 });
    expect(t.rows[0].cells.posts).toBeNull();
  });
});
