/**
 * Google Ads report exports (CSV or Excel): Campaigns, Search terms,
 * Keywords or Ad groups tables, downloaded from the table view or a saved
 * report. Google puts a title and the date range above the table
 * ("Search terms report", "September 1, 2026 - September 30, 2026") and
 * "Total:" rows at the bottom.
 *
 * - Each row is stored by its own dimension (campaign, search term, keyword
 *   or ad group). The same search term under two match types adds up.
 * - Account totals come from Google's own total row ("Total: Account", else
 *   "Total: Campaign(s)"), because search term and keyword reports leave out
 *   "Other search terms": adding up the listed rows would undercount. With
 *   no total row (a daily campaign export), the campaign rows are added up.
 * - With a "Day" column, values are daily; otherwise they cover the date
 *   range in the file header.
 *
 * CTR, Avg. CPC, Cost / conv., Conv. rate and ROAS columns are ignored on
 * purpose: the portal recomputes them from cost, clicks, impressions,
 * conversions and conversion value.
 */
import { norm, num, parseDate } from "../cells";
import type { ParseContext, Parser } from "../types";
import { cell, headerSet, hasAll, hasAny, mapHeaders, missingPeriodMessage } from "./common";

const ROLES = {
  searchTerm: ["Search term"],
  keyword: ["Keyword", "Search keyword"],
  adGroup: ["Ad group", "Ad group name"],
  campaign: ["Campaign", "Campaign name"],
  day: ["Day", "Date"],
  cost: ["Cost", "Cost (USD)", "Spend"],
  impressions: ["Impr.", "Impressions"],
  clicks: ["Clicks"],
  conversions: ["Conversions", "Conv."],
  conversionValue: ["Conv. value", "Conversion value", "Total conv. value"],
};
const IGNORE = [
  "Campaign status", "Campaign state", "Status", "Status reasons", "Campaign type", "Campaign subtype", "Budget*", "Bid strategy*",
  "CTR", "Avg. CPC", "Avg. cost", "Avg. CPM", "Cost / conv.", "Conv. rate", "Conv. value / cost", "Interactions", "Interaction rate",
  "Currency code", "Account*", "Customer ID", "Campaign ID", "Optimization score", "Search impr. share*", "All conv*", "View-through conv.",
  "Labels", "Network*", "Device", "Match type", "Added/Excluded", "Keyword status", "Ad group status", "Ad group state", "Max. CPC",
  "Quality Score*", "Final URL", "Default max. CPC", "Ad group type",
];
const KEYS = ["gads_spend", "gads_impressions", "gads_clicks", "gads_conversions", "gads_conversion_value"] as const;
const MONEY = ["gads_spend", "gads_conversion_value"];

/** Which Google total row stands for the whole account, best first. */
const TOTAL_RANK = [/^total:\s*account/i, /^total:\s*campaigns?$/i];

/** "July 1, 2026 - July 31, 2026" (or with a dash variant) in the lines above the table. */
function headerPeriod(rows: string[][], before: number): { start: string; end: string } | null {
  for (const r of rows.slice(0, before)) {
    for (const c of r) {
      const parts = (c ?? "").split(/\s+[-–—]\s+|\s+to\s+/i);
      if (parts.length !== 2) continue;
      const start = parseDate(parts[0]);
      const end = parseDate(parts[1]);
      if (start && end && end >= start) return { start, end };
    }
  }
  return null;
}

export const googleAdsParser: Parser = {
  id: "google_ads",
  label: "Google Ads report",
  sources: ["google_ads"],

  detect(sheets) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 6);
      if (hasAll(h, "Impr.", "Cost") && hasAny(h, "Campaign", "Search term", "Keyword", "Ad group", "Clicks")) return 0.97;
      if (hasAll(h, "Cost", "Conversions") && hasAny(h, "Avg. CPC", "Cost / conv.") && hasAny(h, "Campaign", "Search term", "Keyword", "Ad group")) return 0.9;
    }
    return 0;
  },

  parse(sheets, ctx: ParseContext, out) {
    let saw = false;
    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => ["impr.", "impressions", "cost"].includes(norm(c))) && r.some((c) => ["clicks", "cost"].includes(norm(c))));
      if (h < 0) continue;
      const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], ROLES, IGNORE);
      out.columns(mapped, unmapped);
      if (idx.cost < 0 && idx.clicks < 0) continue;
      const period = headerPeriod(sheet.rows, h) ?? ctx.period ?? null;

      // The most specific row label decides what each row is.
      const dimension = idx.searchTerm >= 0 ? "search_term" : idx.keyword >= 0 ? "keyword" : idx.adGroup >= 0 ? "ad_group" : "campaign";
      const labelIdx = { search_term: idx.searchTerm, keyword: idx.keyword, ad_group: idx.adGroup, campaign: idx.campaign }[dimension];

      const values = (row: string[]) => ({
        gads_spend: num(cell(row, idx.cost)),
        gads_impressions: num(cell(row, idx.impressions)),
        gads_clicks: num(cell(row, idx.clicks)),
        gads_conversions: num(cell(row, idx.conversions)),
        gads_conversion_value: num(cell(row, idx.conversionValue)),
      });

      const byRow = new Map<string, Record<string, number>>(); // "when|label"
      const sums = new Map<string, Record<string, number>>(); // "when"
      let totalRow: { rank: number; values: ReturnType<typeof values> } | null = null;
      const add = (map: Map<string, Record<string, number>>, k: string, v: ReturnType<typeof values>) => {
        const acc = map.get(k) ?? {};
        for (const key of KEYS) if (v[key] !== null) acc[key] = (acc[key] ?? 0) + v[key]!;
        map.set(k, acc);
      };

      for (const row of sheet.rows.slice(h + 1)) {
        const first = row.find((c) => c && c.trim()) ?? "";
        if (/^total:/i.test(first.trim())) {
          const rank = TOTAL_RANK.findIndex((re) => re.test(first.trim()));
          if (rank >= 0 && (!totalRow || rank < totalRow.rank)) totalRow = { rank, values: values(row) };
          continue;
        }
        const label = (cell(row, labelIdx) ?? "").trim();
        if (!label || label === "--") continue;
        const day = parseDate(cell(row, idx.day));
        if (!day && !period) {
          out.error(missingPeriodMessage("Google Ads"));
          return;
        }
        saw = true;
        out.rowsRead++;
        const when = day ?? `${period!.start}~${period!.end}`;
        const v = values(row);
        add(byRow, `${when}|${label}`, v);
        add(sums, when, v);
      }

      const write = (when: string, key: string, raw: number, dim: string, dimValue: string) => {
        const v = MONEY.includes(key) ? Math.round(raw * 100) / 100 : raw;
        if (when.includes("~")) {
          const [start, end] = when.split("~");
          out.period("google_ads", key, start, end, v, dim, dimValue);
        } else out.daily("google_ads", key, when, v, dim, dimValue);
      };
      for (const [k, vals] of byRow) {
        const [when, label] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
        for (const [key, raw] of Object.entries(vals)) write(when, key, raw, dimension, label.slice(0, 200));
      }

      // Totals: Google's own total row for a date-range export, else the rows added up.
      const whens = [...sums.keys()];
      if (totalRow && whens.length === 1 && whens[0].includes("~")) {
        for (const key of KEYS) if (totalRow.values[key] !== null) write(whens[0], key, totalRow.values[key]!, "", "");
        if (dimension !== "campaign") {
          out.warn(
            `Totals come from Google's "${totalRow.rank === 0 ? "Total: Account" : "Total: Campaign"}" row, which includes search terms Google does not list. If this report was filtered to one campaign, also upload the Campaigns export for account totals.`,
          );
        }
      } else if (dimension === "campaign") {
        for (const [when, vals] of sums) for (const [key, raw] of Object.entries(vals)) write(when, key, raw, "", "");
      } else {
        out.warn("No account total row was found, so only the listed rows were saved. Upload the Campaigns export for account totals.");
      }
      if (idx.conversions < 0) out.warn("No Conversions column, so conversions and cost per conversion are not available.");
    }
    if (!saw) out.error("No rows were found. Export the Campaigns, Search terms or Keywords table from Google Ads as CSV or Excel.");
  },
};
