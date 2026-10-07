import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseDate, parseTimestamp, num, rate } from "./cells";
import { parseUpload } from "./index";
import { parseCsv } from "./table";
import type { ParseContext } from "./types";

const fixture = (name: string) => readFileSync(join(__dirname, "__fixtures__", name));
const ctx = (fileName: string, extra: Partial<ParseContext> = {}): ParseContext => ({ fileName, today: "2026-10-07", ...extra });
const parse = (name: string, extra: Partial<ParseContext> = {}) => parseUpload(fixture(name), ctx(name, extra));
const total = (r: ReturnType<typeof parse>, key: string) => r.totals.find((t) => t.metric_key === key)?.value;

describe("cell helpers", () => {
  it("parses platform number formats", () => {
    expect(num("1,234")).toBe(1234);
    expect(num("$719.19")).toBe(719.19);
    expect(num("(12)")).toBe(-12);
    expect(num("--")).toBeNull();
    expect(rate("98.7%")).toBeCloseTo(0.987);
    expect(rate("0.987")).toBeCloseTo(0.987);
  });

  it("parses platform date formats", () => {
    expect(parseDate("20260701")).toBe("2026-07-01");
    expect(parseDate("2026-07-01T00:00:00")).toBe("2026-07-01");
    expect(parseDate("07/03/2026")).toBe("2026-07-03");
    expect(parseDate("Jul 14, 2026")).toBe("2026-07-14");
    expect(parseDate("July 1", "2026-10-07")).toBe("2026-07-01");
    // A December date seen in January belongs to the previous year.
    expect(parseDate("December 30", "2027-01-05")).toBe("2026-12-30");
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseTimestamp("07/03/2026 2:15 PM")).toBe("2026-07-03T14:15:00Z");
  });

  it("parses quoted CSV with the Excel sep line", () => {
    expect(parseCsv('sep=;\na;"b;c"\n"x ""y""";2\n')).toEqual([
      ["a", "b;c"],
      ['x "y"', "2"],
    ]);
  });
});

describe("Google Analytics 4", () => {
  it("reads a traffic acquisition report as July totals by channel", () => {
    const r = parse("ga4-traffic-acquisition.csv");
    expect(r.ok).toBe(true);
    expect(r.parserId).toBe("ga4_report");
    expect([r.periodStart, r.periodEnd]).toEqual(["2026-07-01", "2026-07-31"]);
    expect(r.granularity).toBe("period");
    expect(total(r, "ga4_sessions")).toBe(430);
    expect(total(r, "ga4_engaged_sessions")).toBe(424);
    expect(total(r, "ga4_key_events")).toBe(391);
    const paid = r.batch.period.find((p) => p.metric_key === "ga4_sessions" && p.dimension_value === "Paid Social");
    expect(paid?.value).toBe(154);
    expect(r.warnings.join(" ")).toMatch(/adding up all channels/);
    expect(r.unmappedColumns).toEqual([]);
  });

  it("reads a daily report", () => {
    const r = parse("ga4-daily.csv");
    expect(r.granularity).toBe("daily");
    expect(r.batch.daily.filter((d) => d.metric_key === "ga4_sessions").map((d) => d.value)).toEqual([10, 12, 14]);
    expect(total(r, "ga4_users")).toBe(33);
  });

  it("needs a period when the file has no dates, and derives engaged sessions from the rate", () => {
    const missing = parse("ga4-landing-no-dates.csv", { source: "ga4" });
    expect(missing.ok).toBe(false);
    expect(missing.errors[0]).toMatch(/Enter the period/);

    const r = parse("ga4-landing-no-dates.csv", { source: "ga4", period: { start: "2026-07-01", end: "2026-07-31" } });
    expect(r.ok).toBe(true);
    const engaged = r.batch.period.find((p) => p.metric_key === "ga4_engaged_sessions" && p.dimension_value === "/roof-inspection");
    expect(engaged?.value).toBe(255);
    expect(r.warnings.join(" ")).toMatch(/engagement rate/);
  });
});

describe("Meta organic", () => {
  it("reads a single-metric Facebook insights export", () => {
    const r = parse("fb-views.csv", { source: "meta_facebook" });
    expect(r.ok).toBe(true);
    expect(r.parserId).toBe("meta_insights");
    expect(total(r, "fb_views")).toBe(325);
  });

  it("infers the platform from the file name", () => {
    expect(parse("fb-views.csv").sources).toEqual(["meta_facebook"]);
  });

  it("refuses to guess the platform when the file does not say", () => {
    const r = parseUpload(fixture("fb-views.csv"), ctx("views.csv"));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/Facebook or an Instagram/);
  });

  it("reads Instagram follows and warns that unfollows are missing", () => {
    const r = parse("ig-follows.csv", { source: "meta_instagram" });
    expect(total(r, "ig_net_new_followers")).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/unfollows/);
  });

  it("reads an Instagram content export into posts", () => {
    const r = parse("ig-content.csv");
    expect(r.ok).toBe(true);
    expect(r.sources).toEqual(["meta_instagram"]);
    expect(r.batch.posts).toHaveLength(3);
    const top = r.batch.posts[0];
    expect(top).toMatchObject({ format: "reel", views: 679, interactions: 40, published_at: "2026-07-03T10:00:00Z" });
    expect(top.summary?.length).toBeLessThanOrEqual(83);
    expect(r.batch.posts[2].format).toBe("photo");
  });
});

describe("Meta Ads", () => {
  it("reads a campaign summary export with exact reach and the report's figures", () => {
    const r = parse("meta-ads-campaign.csv");
    expect(r.ok).toBe(true);
    expect(r.batch.adCampaigns[0]).toMatchObject({ name: "Roof Inspection Lead Gen | West Texas", start_date: "2026-07-14", end_date: null });
    const p = (key: string) => r.batch.period.find((x) => x.metric_key === key && x.dimension === "")?.value;
    expect(p("ads_spend")).toBe(719.19);
    expect(p("ads_leads")).toBe(23);
    expect(p("ads_reach")).toBe(13020);
    expect(p("ads_clicks")).toBe(622);
    expect(r.unmappedColumns).toEqual([]);
  });

  it("reads a daily export, adding up rows and taking leads from Results", () => {
    const r = parse("meta-ads-daily.csv");
    expect(r.ok).toBe(true);
    expect(r.batch.adDaily).toHaveLength(3);
    expect(r.batch.adCampaigns.map((c) => c.name).sort()).toEqual(["Brand Awareness", "Roof Inspection Lead Gen"]);
    expect(total(r, "ads_spend")).toBe(70);
    expect(total(r, "ads_leads")).toBe(3);
    expect(r.warnings.join(" ")).toMatch(/Clicks \(all\)/);
    expect(r.warnings.join(" ")).toMatch(/Results column/);
  });
});

describe("Shopify", () => {
  it("reads total sales over time", () => {
    const r = parse("shopify-sales-over-time.csv");
    expect(r.ok).toBe(true);
    expect(total(r, "shop_total_sales")).toBe(596.73);
    expect(total(r, "shop_orders")).toBe(6);
  });

  it("reads monthly sales by channel and derives store totals", () => {
    const r = parse("shopify-sales-by-channel-month.csv");
    expect(r.ok).toBe(true);
    expect(r.granularity).toBe("period");
    expect(total(r, "shop_total_sales")).toBe(4610.75);
    expect(total(r, "shop_orders")).toBe(45);
    expect(r.batch.period.find((p) => p.dimension_value === "Instagram Shop" && p.metric_key === "shop_orders")?.value).toBe(5);
  });
});

describe("TikTok", () => {
  it("reads the overview with year-less dates", () => {
    const r = parse("tiktok-overview.csv", { source: "tiktok" });
    expect(r.ok).toBe(true);
    expect(r.periodStart).toBe("2026-07-01");
    expect(total(r, "tt_views")).toBe(2180);
    expect(total(r, "tt_interactions")).toBe(159);
  });

  it("reads a gender distribution as an audience snapshot", () => {
    const r = parse("tiktok-gender.csv", { source: "tiktok", period: { start: "2026-07-01", end: "2026-07-31" } });
    expect(r.ok).toBe(true);
    expect(r.batch.snapshots).toEqual([
      expect.objectContaining({ breakdown_type: "gender", bucket: "Female", share: 0.54, snapshot_date: "2026-07-31" }),
      expect.objectContaining({ bucket: "Male", share: 0.46 }),
    ]);
  });
});

describe("LinkedIn", () => {
  it("reads a content export workbook with a note row above the header", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Aggregated metrics for all posts by date"],
        ["Date", "Impressions (organic)", "Impressions (sponsored)", "Clicks (organic)", "Reactions (organic)", "Comments (organic)", "Reposts (organic)", "Engagement rate (organic)"],
        ["07/01/2026", "300", "0", "10", "8", "1", "1", "0.066"],
        ["07/02/2026", "250", "50", "6", "5", "0", "0", "0.044"],
      ]),
      "Metrics",
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["Post performance"],
        ["Post title", "Post link", "Post type", "Created date", "Impressions", "Clicks", "Likes", "Comments", "Reposts", "Content Type"],
        ["We finished a 40 square roof in Lubbock", "https://www.linkedin.com/feed/update/urn:li:activity:7300000000000000001", "Organic", "07/02/2026", "410", "12", "20", "2", "1", "Image"],
      ]),
      "All posts",
    );
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const r = parseUpload(bytes, ctx("company_updates.xlsx", { source: "linkedin" }));
    expect(r.ok).toBe(true);
    expect(total(r, "li_impressions")).toBe(550);
    expect(total(r, "li_interactions")).toBe(31);
    expect(r.batch.posts[0]).toMatchObject({ external_id: "urn:li:activity:7300000000000000001", format: "photo", views: 410, interactions: 35 });
    expect(r.warnings.join(" ")).toMatch(/follower total/);
  });
});

describe("guard rails", () => {
  it("rejects unknown files and wrong extensions", () => {
    expect(parseUpload(new TextEncoder().encode("a,b\n1,2\n"), ctx("x.csv")).errors[0]).toMatch(/could not recognize/);
    expect(parseUpload(new TextEncoder().encode("hello"), ctx("x.pdf")).errors[0]).toMatch(/Screenshots & PDFs tab/);
    expect(parseUpload(new TextEncoder().encode("hello"), ctx("x.docx")).errors[0]).toMatch(/CSV or Excel/);
  });

  it("reads the right parser even when the wrong platform was picked", () => {
    const r = parse("meta-ads-campaign.csv", { source: "ga4" });
    expect(r.parserId).toBe("meta_ads");
    expect(r.warnings[0]).toMatch(/You chose Website/);
  });
});
