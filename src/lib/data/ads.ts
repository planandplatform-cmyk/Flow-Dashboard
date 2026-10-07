import type { DailyRow } from "@/lib/metrics/aggregate";

export interface AdMetricsDailyRow {
  date: string;
  spend: number | string;
  impressions: number | string;
  reach: number | string;
  clicks: number | string;
  leads: number | string;
}

/**
 * Collapse per-campaign ad rows into the generic metric shape (ads_spend,
 * ads_leads, ...). Daily reach is summed across campaigns, which overcounts
 * people reached by more than one campaign; the resolver treats ads_reach as a
 * unique metric and prefers exact period values from metrics_period.
 */
export function adRowsToDaily(rows: AdMetricsDailyRow[]): DailyRow[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const acc = byDate.get(r.date) ?? { spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0 };
    acc.spend += Number(r.spend);
    acc.impressions += Number(r.impressions);
    acc.reach += Number(r.reach);
    acc.clicks += Number(r.clicks);
    acc.leads += Number(r.leads);
    byDate.set(r.date, acc);
  }
  const out: DailyRow[] = [];
  for (const [date, acc] of byDate) {
    for (const [field, value] of Object.entries(acc)) {
      // Round spend sums to cents so floating point noise never shows up.
      out.push({ metric_key: `ads_${field}`, date, value: field === "spend" ? Math.round(value * 100) / 100 : value });
    }
  }
  return out;
}
