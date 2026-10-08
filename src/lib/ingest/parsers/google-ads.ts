/**
 * Google Ads report exports (Campaigns > Download > CSV or Excel, or a saved
 * report). Google puts a title and the date range above the table
 * ("Campaign report", "July 1, 2026 - July 31, 2026") and adds "Total:" rows
 * at the bottom, which are skipped: totals are added up from the campaigns.
 *
 * - With a "Day" column: daily values per campaign.
 * - Without it: totals for the date range in the export header.
 *
 * CTR, Avg. CPC, Cost / conv., Conv. rate and ROAS columns are ignored on
 * purpose: the portal recomputes them from cost, clicks, impressions,
 * conversions and conversion value.
 */
import { norm, num, parseDate } from "../cells";
import type { ParseContext, Parser } from "../types";
import { cell, headerSet, hasAll, hasAny, mapHeaders, missingPeriodMessage } from "./common";

const ROLES = {
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
  "Labels", "Ad group*", "Network*", "Device",
];
const MONEY = ["gads_spend", "gads_conversion_value"];

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
      if (hasAll(h, "Impr.", "Cost") && hasAny(h, "Campaign", "Clicks")) return 0.97;
      if (hasAll(h, "Campaign", "Cost", "Conversions") && hasAny(h, "Avg. CPC", "Cost / conv.")) return 0.9;
    }
    return 0;
  },

  parse(sheets, ctx: ParseContext, out) {
    let saw = false;
    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => ["impr.", "cost"].includes(norm(c))) && r.some((c) => ["campaign", "clicks"].includes(norm(c))));
      if (h < 0) continue;
      const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], ROLES, IGNORE);
      out.columns(mapped, unmapped);
      if (idx.cost < 0 && idx.clicks < 0) continue;
      const period = headerPeriod(sheet.rows, h) ?? ctx.period ?? null;

      // Add up per (day or period) and campaign; totals are the sum of campaigns.
      const totals = new Map<string, Record<string, number>>();
      const add = (when: string, campaign: string, key: string, v: number | null) => {
        if (v === null) return;
        for (const k of [`${when}|`, `${when}|${campaign}`]) {
          const acc = totals.get(k) ?? {};
          acc[key] = (acc[key] ?? 0) + v;
          totals.set(k, acc);
        }
      };

      for (const row of sheet.rows.slice(h + 1)) {
        const name = (cell(row, idx.campaign) ?? "").trim();
        if (!name || /^total[:\s]/i.test(name) || /^--$/.test(name)) continue;
        const day = parseDate(cell(row, idx.day));
        if (!day && !period) {
          out.error(missingPeriodMessage("Google Ads"));
          return;
        }
        saw = true;
        out.rowsRead++;
        const when = day ?? `${period!.start}~${period!.end}`;
        add(when, name, "gads_spend", num(cell(row, idx.cost)));
        add(when, name, "gads_impressions", num(cell(row, idx.impressions)));
        add(when, name, "gads_clicks", num(cell(row, idx.clicks)));
        add(when, name, "gads_conversions", num(cell(row, idx.conversions)));
        add(when, name, "gads_conversion_value", num(cell(row, idx.conversionValue)));
      }

      for (const [k, values] of totals) {
        const [when, campaign] = k.split("|");
        const dim = campaign ? (["campaign", campaign] as const) : (["", ""] as const);
        for (const [key, raw] of Object.entries(values)) {
          const v = MONEY.includes(key) ? Math.round(raw * 100) / 100 : raw;
          if (when.includes("~")) {
            const [start, end] = when.split("~");
            out.period("google_ads", key, start, end, v, ...dim);
          } else out.daily("google_ads", key, when, v, ...dim);
        }
      }
      if (idx.conversions < 0) out.warn("No Conversions column, so conversions and cost per conversion are not available.");
    }
    if (!saw) out.error("No campaign rows were found. Export the Campaigns table from Google Ads as CSV or Excel.");
  },
};
