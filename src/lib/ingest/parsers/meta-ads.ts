/**
 * Meta Ads Manager exports (Ads Manager or Ads Reporting > Export > CSV/XLSX).
 *
 * - With a "Day" breakdown: one row per campaign (or ad set / ad) per day.
 *   Stored as daily delivery per campaign.
 * - Without it: one row per campaign for the reporting window. Stored as
 *   period totals, which also gives exact unique reach for that window.
 *
 * CTR, CPL, CPC and frequency columns are ignored on purpose: the portal
 * recomputes them from spend, clicks, impressions, reach and leads.
 */
import { norm, num, parseDate } from "../cells";
import type { Parser } from "../types";
import { cell, headerSet, hasAny, mapHeaders, missingPeriodMessage } from "./common";

const ROLES = {
  campaign: ["Campaign name", "Campaign"],
  campaignId: ["Campaign ID"],
  adSet: ["Ad set name", "Ad Set Name"],
  ad: ["Ad name"],
  day: ["Day", "Date"],
  reportStart: ["Reporting starts", "Reporting start"],
  reportEnd: ["Reporting ends", "Reporting end"],
  spend: ["Amount spent (USD)", "Amount spent", "Spend", "Amount Spent"],
  impressions: ["Impressions"],
  reach: ["Reach"],
  linkClicks: ["Link clicks", "Clicks (link)"],
  allClicks: ["Clicks (all)", "Clicks"],
  leads: ["Leads", "Leads (form)", "On-Facebook leads", "Meta leads"],
  results: ["Results"],
  resultType: ["Result indicator", "Result type"],
  starts: ["Starts", "Campaign start", "Start date"],
  ends: ["Ends", "Campaign end", "End date", "Stop time"],
  objective: ["Objective", "Campaign objective"],
  delivery: ["Campaign delivery", "Delivery", "Delivery status"],
};
const IGNORE = [
  "Frequency", "CTR*", "CPC*", "CPM*", "Cost per*", "Cost Per*", "Attribution setting", "Bid strategy", "Budget*",
  "Ad set budget*", "Campaign budget*", "Quality ranking", "Engagement rate ranking", "Conversion rate ranking", "Currency",
  "Account name", "Account ID", "Ad set ID", "Ad ID", "Unique*", "Landing page views", "Video*", "ThruPlays", "Post engagements",
  "Post reactions", "Post comments", "Post shares", "Post saves", "Page engagement", "Photo views", "Purchases*", "Website*",
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const metaAdsParser: Parser = {
  id: "meta_ads",
  label: "Meta Ads Manager export",
  sources: ["meta_ads"],

  detect(sheets) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 5);
      if (hasAny(h, "Amount spent (USD)", "Amount spent") && hasAny(h, "Impressions", "Reach")) return 0.97;
      if (hasAny(h, "Campaign name") && hasAny(h, "Reporting starts", "Results")) return 0.85;
    }
    return 0;
  },

  parse(sheets, ctx, out) {
    let sawRows = false;
    let usedAllClicks = false;
    let usedResults = false;
    let missingLeads = false;
    const levelWarned = { adset: false };
    const periodCampaigns = new Map<string, { start: string; end: string }>();

    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => ["amount spent (usd)", "amount spent", "campaign name"].includes(norm(c))));
      if (h < 0) continue;
      const headers = sheet.rows[h];
      const { idx, mapped, unmapped } = mapHeaders(headers, ROLES, IGNORE);
      out.columns(mapped, unmapped);
      if (idx.spend < 0 && idx.impressions < 0) continue;
      if (idx.leads < 0 && !(idx.results >= 0 && idx.resultType >= 0)) missingLeads = true;

      for (const row of sheet.rows.slice(h + 1)) {
        let name = cell(row, idx.campaign) || "";
        if (!name && (cell(row, idx.adSet) || cell(row, idx.ad))) {
          name = cell(row, idx.adSet) || cell(row, idx.ad) || "";
          if (!levelWarned.adset) {
            out.warn("No campaign name column; ad sets or ads were treated as campaigns.");
            levelWarned.adset = true;
          }
        }
        // Summary rows ("Results from 3 campaigns") have no name.
        if (!name || /^results from \d+/i.test(name)) continue;
        sawRows = true;
        out.rowsRead++;

        const externalId = cell(row, idx.campaignId) || `name:${slug(name)}`;
        const spend = num(cell(row, idx.spend)) ?? 0;
        const impressions = num(cell(row, idx.impressions)) ?? 0;
        const reach = num(cell(row, idx.reach)) ?? 0;
        let clicks = num(cell(row, idx.linkClicks));
        if (clicks === null) {
          clicks = num(cell(row, idx.allClicks));
          if (clicks !== null) usedAllClicks = true;
        }
        let leads = num(cell(row, idx.leads));
        if (leads === null && /lead/i.test(cell(row, idx.resultType) ?? "")) {
          leads = num(cell(row, idx.results));
          usedResults = true;
        }

        const day = parseDate(cell(row, idx.day));
        const rStart = parseDate(cell(row, idx.reportStart));
        const rEnd = parseDate(cell(row, idx.reportEnd));
        const ends = cell(row, idx.ends) ?? "";
        out.campaign({
          source: "meta_ads",
          external_campaign_id: externalId,
          name,
          objective: cell(row, idx.objective) || null,
          status: cell(row, idx.delivery) || null,
          start_date: parseDate(cell(row, idx.starts)) ?? day ?? rStart,
          end_date: /ongoing/i.test(ends) ? null : (parseDate(ends) ?? day ?? rEnd),
        });

        if (day) {
          out.adDaily({ external_campaign_id: externalId, date: day, spend, impressions, reach, clicks: clicks ?? 0, leads: leads ?? 0 });
          continue;
        }

        const period = rStart && rEnd ? { start: rStart, end: rEnd } : ctx.period;
        if (!period) {
          out.error(missingPeriodMessage("Meta Ads"));
          return;
        }
        periodCampaigns.set(externalId, period);
        const dim = ["campaign", externalId] as const;
        out.period("meta_ads", "ads_spend", period.start, period.end, spend, ...dim);
        out.period("meta_ads", "ads_impressions", period.start, period.end, impressions, ...dim);
        out.period("meta_ads", "ads_reach", period.start, period.end, reach, ...dim);
        out.period("meta_ads", "ads_clicks", period.start, period.end, clicks ?? 0, ...dim);
        out.period("meta_ads", "ads_leads", period.start, period.end, leads ?? 0, ...dim);
      }
    }

    if (!sawRows) {
      out.error("No campaign rows were found in this Meta Ads export.");
      return;
    }

    // Account totals for period exports. Spend, impressions, clicks and leads
    // add up across campaigns; reach does not (people overlap), so it is only
    // exact when there is one campaign.
    if (periodCampaigns.size) {
      const batch = out.batch();
      const byWindow = new Map<string, typeof batch.period>();
      for (const p of batch.period) {
        if (p.dimension !== "campaign") continue;
        const k = `${p.period_start}|${p.period_end}`;
        byWindow.set(k, [...(byWindow.get(k) ?? []), p]);
      }
      for (const [k, rows] of byWindow) {
        const [start, end] = k.split("|");
        const campaigns = new Set(rows.map((r) => r.dimension_value));
        for (const key of ["ads_spend", "ads_impressions", "ads_clicks", "ads_leads"]) {
          const total = rows.filter((r) => r.metric_key === key).reduce((s, r) => s + r.value, 0);
          out.period("meta_ads", key, start, end, Math.round(total * 100) / 100);
        }
        if (campaigns.size === 1) {
          out.period("meta_ads", "ads_reach", start, end, rows.find((r) => r.metric_key === "ads_reach")!.value);
        } else {
          out.warn(
            `Total reach across ${campaigns.size} campaigns cannot be added up because people overlap. Export at account level (no campaign breakdown) or enter total reach with the manual form.`,
          );
        }
      }
    } else {
      out.warn("Daily exports give daily reach only. For exact reach over the whole period, also upload an export without the Day breakdown.");
    }

    if (usedAllClicks) out.warn("Used Clicks (all) because the file has no Link clicks column.");
    if (usedResults) out.warn("Leads were taken from the Results column (result type: leads).");
    if (missingLeads) out.warn("No Leads column found; leads were recorded as 0. Add the Leads column in Ads Manager if this campaign collects leads.");
  },
};
