/**
 * Second demo client: Lubbock Med Spa. ALL VALUES ARE SYNTHETIC.
 *
 * It exists to show that each client has its own channels: this one runs
 * organic Facebook and Instagram plus Google Analytics, with no Meta Ads
 * (the opposite of Wieler Roofing's ads-led setup).
 */

export const MED_SPA = {
  id: "7c2e4b10-3a9d-4f61-8e25-1b7d9c0e5a02",
  name: "Lubbock Med Spa (Demo)",
  slug: "lubbock-med-spa",
  enabled_sources: ["ga4", "meta_facebook", "meta_instagram"],
  timezone: "America/Chicago",
  market: "Lubbock, TX",
};

type Source = "ga4" | "meta_facebook" | "meta_instagram";
export interface Row {
  source: Source;
  metric_key: string;
  date: string;
  dimension: string;
  dimension_value: string;
  value: number;
}

function prng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

const CHANNELS: [string, number, number][] = [
  // channel, share of sessions, engagement rate
  ["Organic Social", 0.38, 0.71],
  ["Organic Search", 0.34, 0.66],
  ["Direct", 0.2, 0.58],
  ["Referral", 0.08, 0.62],
];

export function generateMedSpa(): {
  daily: Row[];
  snapshots: { platform: Source; type: string; bucket: string; share: number }[];
  commentary: { month: string; headline: string; summary: string; conclusion: string };
} {
  const rand = prng(42);
  const daily: Row[] = [];
  const add = (source: Source, metric_key: string, date: string, value: number, dimension = "", dimension_value = "") =>
    daily.push({ source, metric_key, date, dimension, dimension_value, value });

  let fbFollowers = 820;
  let igFollowers = 2410;
  const start = Date.UTC(2025, 7, 1); // Aug 1, 2025
  const end = Date.UTC(2026, 6, 31); // Jul 31, 2026
  for (let t = start, i = 0; t <= end; t += 86_400_000, i++) {
    const date = new Date(t).toISOString().slice(0, 10);
    const growth = 1 + i / 365; // doubles over the year
    const weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 1.25 : 1;
    const r = (base: number) => Math.max(0, Math.round(base * growth * weekend * (0.7 + rand() * 0.6)));

    const fbNet = Math.round(rand() * 3 - 0.6);
    const igNet = Math.round(rand() * 6 - 1);
    fbFollowers += fbNet;
    igFollowers += igNet;

    add("meta_facebook", "fb_views", date, r(180));
    add("meta_facebook", "fb_interactions", date, r(9));
    add("meta_facebook", "fb_reactions", date, r(5));
    add("meta_facebook", "fb_page_visits", date, r(6));
    add("meta_facebook", "fb_net_new_followers", date, fbNet);
    add("meta_facebook", "fb_followers", date, fbFollowers);

    const igReels = r(420);
    add("meta_instagram", "ig_views", date, igReels + r(260));
    add("meta_instagram", "ig_reels_views", date, igReels);
    add("meta_instagram", "ig_interactions", date, r(38));
    add("meta_instagram", "ig_profile_visits", date, r(24));
    add("meta_instagram", "ig_net_new_followers", date, igNet);
    add("meta_instagram", "ig_followers", date, igFollowers);

    let sessions = 0;
    let engaged = 0;
    let keyEvents = 0;
    for (const [channel, share, er] of CHANNELS) {
      const s = r(48 * share);
      const e = Math.round(s * er * (0.9 + rand() * 0.2));
      const k = Math.round(s * 0.06 * rand() * 2);
      add("ga4", "ga4_sessions", date, s, "channel", channel);
      add("ga4", "ga4_engaged_sessions", date, Math.min(e, s), "channel", channel);
      add("ga4", "ga4_key_events", date, k, "channel", channel);
      sessions += s;
      engaged += Math.min(e, s);
      keyEvents += k;
    }
    add("ga4", "ga4_sessions", date, sessions);
    add("ga4", "ga4_engaged_sessions", date, engaged);
    add("ga4", "ga4_key_events", date, keyEvents);
  }

  return {
    daily,
    snapshots: [
      { platform: "meta_instagram", type: "age", bucket: "25-34", share: 0.41 },
      { platform: "meta_instagram", type: "age", bucket: "35-44", share: 0.29 },
      { platform: "meta_instagram", type: "age", bucket: "18-24", share: 0.14 },
      { platform: "meta_instagram", type: "age", bucket: "45-54", share: 0.11 },
      { platform: "meta_instagram", type: "gender", bucket: "Women", share: 0.86 },
      { platform: "meta_instagram", type: "gender", bucket: "Men", share: 0.14 },
      { platform: "meta_instagram", type: "country", bucket: "United States", share: 0.95 },
    ],
    commentary: {
      month: "2026-07-01",
      headline: "Demo Client: Organic Growth Without Paid Ads",
      summary:
        "This is a demo client with synthetic numbers. It shows a report for a business that runs organic Facebook and Instagram plus Google Analytics, with no Meta Ads. The ad section is hidden because the channel is not turned on.",
      conclusion: "Demo data only. Replace this client with a real one, or archive it from its settings page.",
    },
  };
}
