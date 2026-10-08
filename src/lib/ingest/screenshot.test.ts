import { describe, expect, it, vi } from "vitest";
import { buildScreenshotResult, extractionSchema, reviewExtraction, type Extraction } from "./screenshot";

const july = { start: "2026-07-01", end: "2026-07-31" };

const extraction = (over: Partial<Extraction> = {}): Extraction => ({
  is_analytics_screenshot: true,
  platform_seen: "facebook",
  date_range: { start: "2026-07-01", end: "2026-07-31", label: "Jul 1 - Jul 31, 2026" },
  metrics: [
    { key: "fb_views", value: 21239, value_text: "21,239", label_seen: "Views", image_index: 1, confidence: "high" },
    { key: "fb_interactions", value: 362, value_text: "362", label_seen: "Content interactions", image_index: 1, confidence: "high" },
    { key: "fb_followers", value: 51, value_text: "51", label_seen: "Followers", image_index: 2, confidence: "medium" },
  ],
  breakdowns: [
    { type: "discovery_surface", bucket: "Feed", percent: 58, image_index: 2, confidence: "high" },
    { type: "discovery_surface", bucket: "Reels", percent: 36.4, image_index: 2, confidence: "high" },
  ],
  competitors: [],
  campaign_name: null,
  notes: [],
  ...over,
});

describe("reviewing what the model read", () => {
  it("uses the dates on screen and keeps exact values", () => {
    const r = reviewExtraction(extraction(), "meta_facebook", undefined);
    expect(r.errors).toEqual([]);
    expect(r.period).toEqual(july);
    expect(r.items.map((i) => [i.key, i.value])).toEqual([["fb_views", 21239], ["fb_interactions", 362], ["fb_followers", 51]]);
  });

  it("flags rounded numbers and trusts the printed text over the model's number", () => {
    const r = reviewExtraction(
      extraction({
        metrics: [
          { key: "fb_views", value: 21200, value_text: "21.2K", label_seen: "Views", image_index: 1, confidence: "high" },
          { key: "fb_reach", value: 13200, value_text: "13,020", label_seen: "Reach", image_index: 1, confidence: "high" },
        ],
      }),
      "meta_facebook",
      undefined,
    );
    expect(r.items[0]).toMatchObject({ value: 21200, confidence: "medium" });
    expect(r.items[0].note).toMatch(/rounded/);
    expect(r.items[1]).toMatchObject({ value: 13020 });
    expect(r.items[1].note).toMatch(/screen shows 13,020/);
  });

  it("asks for dates when only a relative range is shown, and uses entered dates", () => {
    const relative = extraction({ date_range: null, notes: ["Range shown: Last 28 days"] });
    const missing = reviewExtraction(relative, "meta_facebook", undefined);
    expect(missing.period).toBeNull();
    expect(missing.errors[0]).toMatch(/No dates are visible/);
    expect(reviewExtraction(relative, "meta_facebook", july).period).toEqual(july);
  });

  it("warns when the screenshot is from another platform or not analytics", () => {
    expect(reviewExtraction(extraction({ platform_seen: "instagram" }), "meta_facebook", undefined).warnings[0]).toMatch(/instagram/);
    expect(reviewExtraction(extraction({ is_analytics_screenshot: false }), "meta_facebook", undefined).errors[0]).toMatch(/do not look like/);
  });
});

describe("building the batch from reviewed values", () => {
  it("stores totals for the range and followers on the last day", () => {
    const r = buildScreenshotResult({
      platform: "meta_facebook",
      period: july,
      campaignName: null,
      metrics: [
        { key: "fb_views", value: 21239 },
        { key: "fb_followers", value: 51 },
      ],
      breakdowns: [{ type: "discovery_surface", bucket: "Feed", percent: 58 }],
    });
    expect(r.ok).toBe(true);
    expect(r.batch.period).toEqual([expect.objectContaining({ metric_key: "fb_views", period_start: "2026-07-01", period_end: "2026-07-31", value: 21239 })]);
    expect(r.batch.daily).toEqual([expect.objectContaining({ metric_key: "fb_followers", date: "2026-07-31", value: 51 })]);
    expect(r.batch.snapshots[0]).toMatchObject({ breakdown_type: "discovery_surface", share: 0.58, period_start: "2026-07-01" });
  });

  it("adds up LinkedIn interaction components", () => {
    const r = buildScreenshotResult({
      platform: "linkedin",
      period: july,
      campaignName: null,
      metrics: [
        { key: "li_impressions", value: 5400 },
        { key: "li_reactions", value: 80 },
        { key: "li_comments", value: 6 },
        { key: "li_clicks", value: 40 },
      ],
      breakdowns: [],
    });
    expect(r.ok).toBe(true);
    expect(r.batch.period.find((p) => p.metric_key === "li_interactions")?.value).toBe(126);
    expect(r.warnings.join(" ")).toMatch(/missing: Reposts/);
  });

  it("creates a campaign for Meta Ads so the report's ad section shows", () => {
    const r = buildScreenshotResult({
      platform: "meta_ads",
      period: { start: "2026-07-14", end: "2026-08-06" },
      campaignName: "Roof Inspection Lead Gen",
      metrics: [
        { key: "ads_spend", value: 719.19 },
        { key: "ads_reach", value: 13020 },
        { key: "ads_leads", value: 23 },
      ],
      breakdowns: [],
    });
    expect(r.ok).toBe(true);
    expect(r.batch.adCampaigns[0]).toMatchObject({ name: "Roof Inspection Lead Gen", start_date: "2026-07-14", end_date: "2026-08-06" });
    expect(r.batch.period.filter((p) => p.dimension === "").map((p) => p.metric_key).sort()).toEqual(["ads_leads", "ads_reach", "ads_spend"]);
  });

  it("rejects bad input from the browser", () => {
    const base = { platform: "meta_facebook" as const, period: july, campaignName: null, breakdowns: [] };
    expect(buildScreenshotResult({ ...base, metrics: [{ key: "ig_views", value: 1 }] }).ok).toBe(false);
    expect(buildScreenshotResult({ ...base, metrics: [{ key: "fb_views", value: Number.NaN }] }).ok).toBe(false);
    expect(buildScreenshotResult({ ...base, metrics: [{ key: "fb_views", value: -3 }] }).ok).toBe(false);
    expect(buildScreenshotResult({ ...base, period: { start: "2026-07-31", end: "2026-07-01" }, metrics: [{ key: "fb_views", value: 1 }] }).ok).toBe(false);
    expect(buildScreenshotResult({ ...base, metrics: [{ key: "fb_views", value: 1 }, { key: "fb_views", value: 2 }] }).ok).toBe(false);
  });
});

describe("the request sent to Claude", () => {
  it("sends every image and PDF with structured output and refusal fallback", async () => {
    vi.resetModules();
    const parse = vi.fn().mockResolvedValue({ stop_reason: "end_turn", parsed_output: extraction() });
    vi.doMock("server-only", () => ({}));
    vi.doMock("@anthropic-ai/sdk", async () => {
      const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
      class Fake {
        beta = { messages: { parse } };
      }
      return { ...actual, default: Object.assign(Fake, actual.default) };
    });
    const { readScreenshots } = await import("./screenshot-reader");
    const out = await readScreenshots(
      [
        { data: "AAAA", mediaType: "image/png" },
        { data: "BBBB", mediaType: "image/webp" },
        { data: "CCCC", mediaType: "application/pdf" },
      ],
      "meta_facebook",
      "2026-10-07",
    );
    expect(out.metrics).toHaveLength(3);
    const req = parse.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(req.output_config.format.type).toBe("json_schema");
    const images = req.messages[0].content.filter((c: { type: string }) => c.type === "image");
    expect(images.map((i: { source: { media_type: string } }) => i.source.media_type)).toEqual(["image/png", "image/webp"]);
    const docs = req.messages[0].content.filter((c: { type: string }) => c.type === "document");
    expect(docs).toEqual([{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "CCCC" } }]);
    expect(req.messages[0].content.at(-1).text).toMatch(/fb_views/);
  });

  it("only allows the chosen platform's metric keys", () => {
    const schema = extractionSchema("linkedin");
    const bad = { ...extraction(), metrics: [{ key: "fb_views", value: 1, value_text: "1", label_seen: "x", image_index: 1, confidence: "high" }] };
    expect(schema.safeParse(bad).success).toBe(false);
  });
});

describe("Google Analytics reports", () => {
  it("saves GA4 totals as period values", () => {
    const r = buildScreenshotResult({
      platform: "ga4",
      period: { start: "2026-09-01", end: "2026-09-30" },
      campaignName: null,
      metrics: [
        { key: "ga4_sessions", value: 1200 },
        { key: "ga4_users", value: 950 },
      ],
      breakdowns: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.period.map((p) => [p.source, p.metric_key, p.value])).toEqual([
      ["ga4", "ga4_sessions", 1200],
      ["ga4", "ga4_users", 950],
    ]);
  });

  it("does not let the model report a rate", () => {
    const keys = extractionSchema("ga4").shape.metrics.element.shape.key.options;
    expect(keys).not.toContain("ga4_engagement_rate");
  });
});

describe("LinkedIn competitor comparison", () => {
  const competitors: Extraction["competitors"] = [
    { company: "Diversified Energy Company", is_your_page: false, metric: "engagements", value: 2204, value_text: "2,204", change_percent: 105.8, image_index: 1, confidence: "high" },
    { company: "MCWL Paladin Geological", is_your_page: true, metric: "engagements", value: 244, value_text: "244", change_percent: 31.9, image_index: 1, confidence: "high" },
    { company: "Impac Exploration Services", is_your_page: false, metric: "posts", value: 0, value_text: "0", change_percent: null, image_index: 2, confidence: "high" },
  ];

  it("keeps competitor rows for LinkedIn and saves them by company", () => {
    const review = reviewExtraction(extraction({ platform_seen: "linkedin", metrics: [], breakdowns: [], competitors }), "linkedin", undefined);
    expect(review.competitors.map((c) => [c.company, c.own, c.metric, c.value, c.change])).toEqual([
      ["Diversified Energy Company", false, "engagements", 2204, 105.8],
      ["MCWL Paladin Geological", true, "engagements", 244, 31.9],
      ["Impac Exploration Services", false, "posts", 0, null],
    ]);
    const r = buildScreenshotResult({ platform: "linkedin", period: july, campaignName: null, metrics: [], breakdowns: [], competitors: review.competitors });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = r.batch.period.map((p) => [p.metric_key, p.dimension, p.dimension_value, p.value]);
    expect(rows).toContainEqual(["li_comp_engagements", "own_page", "MCWL Paladin Geological", 244]);
    expect(rows).toContainEqual(["li_comp_engagements_change", "competitor", "Diversified Energy Company", 1.058]);
    expect(rows).toContainEqual(["li_comp_posts", "competitor", "Impac Exploration Services", 0]);
    expect(rows.filter((x) => x[0] === "li_comp_posts_change")).toEqual([]);
  });

  it("accepts a drop shown by LinkedIn (a negative change)", () => {
    const r = buildScreenshotResult({
      platform: "linkedin",
      period: { start: "2026-09-01", end: "2026-09-30" },
      campaignName: null,
      metrics: [],
      breakdowns: [],
      competitors: [
        { company: "MCWL Paladin Geological", own: true, metric: "new_followers", value: 117, change: -29.1 },
        { company: "Impac Exploration Services", own: false, metric: "engagements", value: 0, change: -100 },
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.batch.period.find((p) => p.metric_key === "li_comp_new_followers_change")?.value).toBeCloseTo(-0.291, 6);
  });

  it("ignores competitor rows for other platforms", () => {
    expect(reviewExtraction(extraction({ competitors }), "meta_facebook", undefined).competitors).toEqual([]);
  });
});
