import { describe, expect, it, vi } from "vitest";
import { MetricResolver } from "@/lib/metrics/aggregate";
import { cleanCopy, hasDash } from "./copy";
import { buildMonthFacts, factsToText } from "./facts";

const resolver = new MetricResolver({
  daily: [
    { metric_key: "fb_views", date: "2026-07-10", value: 11532 },
    { metric_key: "fb_views", date: "2026-06-10", value: 195 },
    { metric_key: "ig_views", date: "2026-07-10", value: 900 },
    { metric_key: "ig_views", date: "2026-06-10", value: 1000 },
    { metric_key: "ga4_sessions", date: "2026-07-03", value: 430 },
    { metric_key: "ga4_sessions", date: "2026-07-03", value: 154, dimension: "channel", dimension_value: "Paid Social" },
    { metric_key: "ads_leads", date: "2026-07-20", value: 23 },
    { metric_key: "ads_spend", date: "2026-07-20", value: 719.19 },
    { metric_key: "li_impressions", date: "2026-07-10", value: 5000 },
  ],
  period: [],
});

const facts = () =>
  buildMonthFacts({
    clientName: "Wieler Roofing",
    market: "Lubbock, TX",
    month: "2026-07-01",
    range: { start: "2026-07-01", end: "2026-07-31" },
    previous: { start: "2026-06-01", end: "2026-06-30" },
    enabled: ["ga4", "meta_facebook", "meta_instagram", "meta_ads"],
    resolver,
    ads: { range: { start: "2026-07-14", end: "2026-08-06" }, campaigns: ["Roof Inspection Leads"] },
    annotations: [{ date: "2026-07-14", label: "Moved budget from Google Ads to Meta Ads" }],
  });

describe("month facts", () => {
  it("covers only the client's channels, with comparisons", () => {
    const f = facts();
    expect(f.sections.map((s) => s.id)).toEqual(["combined", "ga4", "meta_facebook", "meta_instagram", "meta_ads"]);
    const fb = f.sections.find((s) => s.id === "meta_facebook")!.metrics.find((m) => m.key === "fb_views")!;
    expect(fb).toMatchObject({ value: "11,532", previous: "195", sentiment: "positive" });
    expect(fb.change).toBe("+5,814% (+11,337)");
    // LinkedIn data exists but the channel is off.
    expect(factsToText(f)).not.toMatch(/LinkedIn|Impressions/);
  });

  it("labels paid separately and uses the campaign window", () => {
    const ads = facts().sections.find((s) => s.id === "meta_ads")!;
    expect(ads.label).toBe("Meta Ads (paid)");
    expect(ads.window).toBe("Jul 14 to Aug 6, 2026");
    expect(ads.details).toEqual(["Campaigns: Roof Inspection Leads"]);
    expect(ads.metrics.find((m) => m.key === "ads_leads")).toMatchObject({ value: "23", previous: null, change: null });
  });

  it("includes breakdowns and events in the fact sheet", () => {
    const text = factsToText(facts());
    expect(text).toMatch(/Sessions by channel: Paid Social 154/);
    expect(text).toMatch(/2026-07-14: Moved budget/);
    expect(text).toMatch(/Reporting month: July 2026\. Comparison: June 2026\./);
  });
});

describe("copy rules", () => {
  it("removes em and en dashes", () => {
    expect(cleanCopy("Views grew — fast. Ages 25–34 led.")).toBe("Views grew, fast. Ages 25 to 34 led.");
    expect(hasDash(cleanCopy("A – B — C"))).toBe(false);
  });
});

describe("the request sent to Claude", () => {
  it("sends the fact sheet with the house rules and tidies the answer", async () => {
    vi.resetModules();
    const parse = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: {
        headline: "Real Leads — Immediate Results!",
        summary: "On July 14 — budget moved.",
        platforms: [
          { section_id: "meta_facebook", headline: "11,532 Views", body: "Up from 195." },
          { section_id: "linkedin", headline: "x", body: "y" },
        ],
        section_notes: { content: "  ", demographics: null, discovery: null, video: null },
        conclusion: "Done.",
        recap_email: { subject: "July Analytics Report, Wieler Roofing", body: "Hi [First name]," },
      },
    });
    vi.doMock("server-only", () => ({}));
    vi.doMock("@anthropic-ai/sdk", async () => {
      const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
      class Fake {
        beta = { messages: { parse } };
      }
      return { ...actual, default: Object.assign(Fake, actual.default) };
    });
    const { draftCommentary } = await import("./drafter");
    const draft = await draftCommentary(facts(), { reportUrl: "https://portal/c/wieler-roofing?month=2026-07", signer: "Marcus Johnson" });

    const req = parse.mock.calls[0][0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.fallbacks).toBe("default");
    expect(req.system).toMatch(/No recommendations/);
    expect(req.system).toMatch(/No em dashes/);
    expect(req.messages[0].content).toMatch(/Facebook \(organic\)/);
    expect(req.messages[0].content).toMatch(/Marcus Johnson/);

    expect(draft.headline).toBe("Real Leads, Immediate Results.");
    expect(draft.summary).toBe("On July 14, budget moved.");
    expect(draft.platforms.map((p) => p.section_id)).toEqual(["meta_facebook"]);
    expect(draft.section_notes.content).toBeNull();
  });
});
