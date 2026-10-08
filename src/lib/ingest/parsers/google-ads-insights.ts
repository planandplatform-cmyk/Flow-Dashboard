/**
 * Google Ads exports that are not performance tables:
 *
 * - Auction insights ("Display URL domain", "Impression share", ...): how
 *   often your ads showed and ranked against competitors. "You" is the
 *   account's own row; every other row is a competitor's domain. Values are
 *   readings for the report's date range. Google shows "< 10%" for small
 *   shares and "--" where a measure does not apply; both are left out.
 * - Demographics by age, gender, or gender and age (from the overview page):
 *   who saw the ads, stored as each group's share of impressions.
 *
 * The date range comes from the line above the table, the file name
 * ("DemographicsAge_2026.09.01-2026.09.30.csv"), or the period entered.
 */
import { norm, num } from "../cells";
import type { BreakdownType, ParseContext, Parser } from "../types";
import { cell, fileNamePeriod, headerSet, hasAll, hasAny, mapHeaders, missingPeriodMessage } from "./common";
import { headerPeriod } from "./google-ads";

const AUCTION = {
  domain: ["Display URL domain"],
  gads_impression_share: ["Impression share", "Search impr. share"],
  gads_overlap_rate: ["Overlap rate"],
  gads_position_above_rate: ["Position above rate"],
  gads_top_of_page_rate: ["Top of page rate"],
  gads_abs_top_rate: ["Abs. Top of page rate", "Absolute top of page rate"],
  gads_outranking_share: ["Outranking share"],
};
const AUCTION_KEYS = Object.keys(AUCTION).filter((k) => k !== "domain") as (keyof typeof AUCTION)[];

const DEMO = { gender: ["Gender"], age: ["Age Range", "Age"], impressions: ["Impressions", "Impr."], percent: ["Percent of known total"] };
const UNKNOWN = new Set(["unknown", "undetermined", "not specified"]);

const isAuction = (h: Set<string>) => hasAll(h, "Display URL domain") && hasAny(h, "Impression share", "Top of page rate");
const isDemographics = (h: Set<string>) => hasAny(h, "Age Range", "Gender") && hasAll(h, "Percent of known total");

export const googleAdsInsightsParser: Parser = {
  id: "google_ads_insights",
  label: "Google Ads auction insights or demographics",
  sources: ["google_ads"],

  detect(sheets) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 6);
      if (isAuction(h) || isDemographics(h)) return 0.97;
    }
    return 0;
  },

  parse(sheets, ctx: ParseContext, out) {
    let saw = false;
    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => ["display url domain", "age range", "gender"].includes(norm(c))));
      if (h < 0) continue;
      const period = headerPeriod(sheet.rows, h) ?? fileNamePeriod(ctx.fileName) ?? ctx.period ?? null;
      if (!period) {
        out.error(missingPeriodMessage("Google Ads"));
        return;
      }
      const headers = headerSet([sheet.rows[h]], 1);

      if (isAuction(headers)) {
        const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], AUCTION);
        out.columns(mapped, unmapped);
        let small = false;
        for (const row of sheet.rows.slice(h + 1)) {
          const domain = (cell(row, idx.domain) ?? "").trim();
          if (!domain) continue;
          const you = domain.toLowerCase() === "you";
          saw = true;
          out.rowsRead++;
          for (const key of AUCTION_KEYS) {
            const raw = cell(row, idx[key]);
            if (raw && /</.test(raw)) small = true;
            const v = num(raw);
            if (v === null) continue;
            out.period("google_ads", key, period.start, period.end, Math.round(v * 100) / 10000, you ? "" : "competitor", you ? "" : domain.slice(0, 200));
          }
        }
        if (small) out.warn('Google shows "< 10%" for small shares. Those cells were left out and show as "Under 10%" in the report.');
        continue;
      }

      if (isDemographics(headers)) {
        const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], DEMO);
        out.columns(mapped, unmapped);
        // Combined gender and age files are split into both breakdowns.
        const totals: Record<"age" | "gender", Map<string, number>> = { age: new Map(), gender: new Map() };
        for (const row of sheet.rows.slice(h + 1)) {
          const impressions = num(cell(row, idx.impressions)) ?? num(cell(row, idx.percent));
          if (impressions === null) continue;
          const groups: ["age" | "gender", string | undefined][] = [
            ["age", cell(row, idx.age)],
            ["gender", cell(row, idx.gender)],
          ];
          let counted = false;
          for (const [type, raw] of groups) {
            const bucket = (raw ?? "").trim();
            if (!bucket || UNKNOWN.has(bucket.toLowerCase())) continue;
            totals[type].set(bucket, (totals[type].get(bucket) ?? 0) + impressions);
            counted = true;
          }
          if (counted) {
            saw = true;
            out.rowsRead++;
          }
        }
        for (const type of ["age", "gender"] as BreakdownType[]) {
          const map = totals[type as "age" | "gender"];
          const sum = [...map.values()].reduce((a, b) => a + b, 0);
          if (!sum) continue;
          for (const [bucket, v] of map) {
            out.snapshot({ platform: "google_ads", snapshot_date: period.end, period_start: period.start, breakdown_type: type, bucket, share: Math.round((v / sum) * 10000) / 10000 });
          }
        }
      }
    }
    if (!saw) out.error("No rows were found. Export the Auction insights or Demographics table from Google Ads as CSV.");
  },
};
