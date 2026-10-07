/**
 * Demo client: Wieler Roofing.
 *
 * Provenance of every number below:
 *   REPORT    taken directly from FFM's July 2026 PDF report.
 *   DERIVED   computed from a REPORT figure (e.g. June from a MoM % change).
 *   PLACEHOLDER  not in the report; plausible value so the module renders.
 *                Replace with real exports in Phase 2.
 *   SYNTHETIC  Aug 2025 to May 2026 history, generated so 12-month trend
 *              charts have shape. Not real data.
 */

export const CLIENT = {
  id: "5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01",
  name: "Wieler Roofing",
  slug: "wieler-roofing",
  enabled_sources: ["ga4", "meta_facebook", "meta_instagram", "meta_ads"],
  timezone: "America/Chicago",
  market: "West Texas",
};

/** Monthly totals for additive metrics. Followers handled separately. */
export interface MonthTotals {
  fb_views: number;
  fb_interactions: number;
  fb_reactions: number;
  fb_page_visits: number;
  fb_reels_interactions: number;
  fb_net_new_followers: number;
  ig_views: number;
  ig_interactions: number;
  ig_profile_visits: number;
  ig_reels_views: number;
  ig_reels_interactions: number;
  ig_post_views: number;
  ig_net_new_followers: number;
  ga4_sessions: number;
  ga4_engaged_sessions: number;
  ga4_key_events: number;
  ga4_page_views: number;
}

export const JULY_2026: MonthTotals = {
  fb_views: 21239, // REPORT
  fb_interactions: 362, // REPORT
  fb_reactions: 52, // REPORT
  fb_page_visits: 155, // REPORT
  fb_reels_interactions: 127, // DERIVED: 35% Reels engagement share x 362
  fb_net_new_followers: 3, // REPORT
  ig_views: 2254, // REPORT
  ig_interactions: 94, // REPORT
  ig_profile_visits: 52, // REPORT
  ig_reels_views: 1400, // REPORT
  ig_reels_interactions: 41, // REPORT
  ig_post_views: 822, // REPORT
  ig_net_new_followers: 8, // REPORT
  ga4_sessions: 430, // REPORT
  ga4_engaged_sessions: 424, // DERIVED: 98.6% engagement rate x 430
  ga4_key_events: 391, // PLACEHOLDER (report gives 379 on the inspection page only)
  ga4_page_views: 623, // PLACEHOLDER (sum of landing page views below)
};

export const JULY_FOLLOWERS_END = { fb: 51, ig: 213 }; // REPORT

/**
 * June 2026. FB views and engagement DERIVED from the report's MoM changes
 * (+5,800% and +2,486%). IG follower end DERIVED from +3.9% (213 / 1.039).
 * Everything else PLACEHOLDER, kept in line with the synthetic history.
 */
export const JUNE_2026: MonthTotals = {
  fb_views: 360, // DERIVED 21,239 / 59
  fb_interactions: 14, // DERIVED 362 / 25.86
  fb_reactions: 6,
  fb_page_visits: 11,
  fb_reels_interactions: 3,
  fb_net_new_followers: 1,
  ig_views: 2010,
  ig_interactions: 81,
  ig_profile_visits: 44,
  ig_reels_views: 1190,
  ig_reels_interactions: 33,
  ig_post_views: 760,
  ig_net_new_followers: 5,
  ga4_sessions: 352,
  ga4_engaged_sessions: 218,
  ga4_key_events: 14,
  ga4_page_views: 610,
};
export const JUNE_FOLLOWERS_END = { fb: 48, ig: 205 }; // DERIVED (July start)

/** GA4 July breakdowns. PLACEHOLDER except where noted; totals tie out to JULY_2026. */
export const JULY_CHANNELS = [
  // Paid Social sessions and 98.7% engagement rate are REPORT figures.
  { channel: "Paid Social", sessions: 154, engaged: 152, key_events: 360 },
  { channel: "Organic Search", sessions: 118, engaged: 116, key_events: 18 },
  { channel: "Direct", sessions: 96, engaged: 95, key_events: 9 },
  { channel: "Organic Social", sessions: 38, engaged: 37, key_events: 3 },
  { channel: "Referral", sessions: 24, engaged: 24, key_events: 1 },
];

export const JUNE_CHANNELS = [
  { channel: "Paid Search", sessions: 148, engaged: 96, key_events: 9 },
  { channel: "Organic Search", sessions: 104, engaged: 64, key_events: 3 },
  { channel: "Direct", sessions: 71, engaged: 39, key_events: 2 },
  { channel: "Organic Social", sessions: 18, engaged: 11, key_events: 0 },
  { channel: "Referral", sessions: 11, engaged: 8, key_events: 0 },
];

export const JULY_LANDING_PAGES = [
  // /roof-inspection views (387) and key events (379) are REPORT figures;
  // its 258 sessions are DERIVED from "60% of all site traffic".
  { page: "/roof-inspection", sessions: 258, engaged: 255, views: 387, key_events: 379 },
  { page: "/", sessions: 102, engaged: 100, views: 141, key_events: 8 },
  { page: "/services", sessions: 41, engaged: 40, views: 58, key_events: 3 },
  { page: "/contact", sessions: 29, engaged: 29, views: 37, key_events: 1 },
];

export const JUNE_LANDING_PAGES = [
  { page: "/", sessions: 189, engaged: 112, views: 330, key_events: 6 },
  { page: "/services", sessions: 88, engaged: 58, views: 160, key_events: 4 },
  { page: "/roof-inspection", sessions: 47, engaged: 30, views: 81, key_events: 3 },
  { page: "/contact", sessions: 28, engaged: 18, views: 39, key_events: 1 },
];

/** Meta Ads, campaign window July 14 to August 6, 2026. All REPORT unless noted. */
export const AD_CAMPAIGN = {
  id: "8a3d2f60-1c4b-4e7a-b5d2-6f9e0a1b2c03",
  external_campaign_id: "seed-wieler-leadgen-2026-07",
  name: "Roof Inspection Lead Gen | West Texas", // PLACEHOLDER name
  objective: "OUTCOME_LEADS",
  status: "ACTIVE",
  start_date: "2026-07-14",
  end_date: "2026-08-06",
  totals: {
    leads: 23,
    spend: 719.19,
    reach: 13020,
    impressions: 28514, // DERIVED: reach x 2.19 frequency
    clicks: 622, // DERIVED: impressions x 2.18% CTR
  },
};

export const POSTS = [
  { external_id: "seed-ig-001", platform: "meta_instagram", format: "reel", summary: "\"Welcome to West Texas\"", published_at: "2026-07-03T15:00:00Z", views: 679 },
  { external_id: "seed-ig-002", platform: "meta_instagram", format: "reel", summary: "\"10 Second Roofing Project\"", published_at: "2026-07-10T15:00:00Z", views: 277 },
  { external_id: "seed-ig-003", platform: "meta_instagram", format: "reel", summary: "Roofing Project Overview", published_at: "2026-07-17T15:00:00Z", views: 211 },
  { external_id: "seed-ig-004", platform: "meta_instagram", format: "photo", summary: "Roofing Project Photo", published_at: "2026-07-24T15:00:00Z", views: 195 },
] as const;

/** Audience and discovery shares (fractions). REPORT unless noted. */
export const SNAPSHOTS = [
  // Instagram demographics, point in time at July 31.
  { platform: "meta_instagram", type: "age", bucket: "25-34", share: 0.375 },
  { platform: "meta_instagram", type: "age", bucket: "35-44", share: 0.263 },
  { platform: "meta_instagram", type: "age", bucket: "45-54", share: 0.163 },
  { platform: "meta_instagram", type: "age", bucket: "18-24", share: 0.156 },
  { platform: "meta_instagram", type: "gender", bucket: "Men", share: 0.506 },
  { platform: "meta_instagram", type: "gender", bucket: "Women", share: 0.494 },
  { platform: "meta_instagram", type: "country", bucket: "United States", share: 0.892 },
  { platform: "meta_instagram", type: "language", bucket: "English", share: 0.958 },
  // Discovery, July period.
  { platform: "meta_facebook", type: "discovery_surface", bucket: "Feed", share: 0.58 },
  { platform: "meta_facebook", type: "discovery_surface", bucket: "Reels", share: 0.364 },
  { platform: "meta_instagram", type: "follower_status", bucket: "Non-followers", share: 0.585 },
  { platform: "meta_instagram", type: "follower_status", bucket: "Followers", share: 0.415 },
  { platform: "meta_facebook", type: "follower_status_engagement", bucket: "Non-followers", share: 0.6 },
  { platform: "meta_facebook", type: "follower_status_engagement", bucket: "Followers", share: 0.4 },
  // Facebook engagement by format: Reels 35% (REPORT), Link + Reels 75% (REPORT) so Links 40%.
  { platform: "meta_facebook", type: "format_engagement", bucket: "Link Posts", share: 0.4 },
  { platform: "meta_facebook", type: "format_engagement", bucket: "Reels", share: 0.35 },
  { platform: "meta_facebook", type: "format_engagement", bucket: "Other", share: 0.25 },
] as const;

/**
 * July commentary, adapted from the PDF. Em dashes removed per the copy rules.
 * Hero totals are recomputed by the dashboard, so the summary avoids
 * repeating the "Total Audience Reach" figure.
 */
export const JULY_COMMENTARY = {
  month: "2026-07-01",
  headline: "A New Strategy. Real Leads. Immediate Results.",
  summary: [
    "On July 14, Wieler Roofing moved its full paid advertising budget from Google Ads to Meta Ads. In the 23 days that followed, the campaign generated 23 new leads, reached 13,020 people, and transformed the brand's digital presence across every channel.",
    "July 2026 was the month everything changed. The campaign produced 23 leads at $31.27 per lead and delivered a 2.18% click-through rate, all on a partial month of spend totaling $719.19. These are not vanity metrics. These are real people in West Texas who saw the ad, clicked through, and raised their hand for roofing services.",
    "The impact was felt across every platform. Facebook page views surged 5,800% compared to the prior month. Paid Social became the number one source of website traffic, driving 154 sessions at a 98.7% engagement rate. The roof inspection landing page alone captured 387 views and 379 key events, confirming that the paid audience is landing on the right page and taking action.",
  ].join("\n\n"),
  platform_narratives: {
    meta_facebook: {
      headline: "21,239 Views, 362 Engagements",
      body: "The Facebook page experienced unprecedented growth in July, driven by the Meta Ads launch on July 14. The page was relatively quiet in the first two weeks of the month, then took off once the paid campaign went live. 60% of all engagement came from non-followers, proving the content is reaching a brand new audience.",
    },
    meta_instagram: {
      headline: "2,254 Views, 94 Interactions",
      body: "Instagram continued to build steady momentum in July, with strong viewership and a highly local audience. Reels were the dominant format, generating 1,400 views compared to 822 for standard posts. The audience is 89.2% U.S.-based, and 95.8% of followers are English speakers.",
    },
    meta_ads: {
      headline: "23 Leads Generated in the First 23 Days",
      body: "The campaign launched with immediate results, reaching 13,020 people in its first 23 days. With a 2.18% click-through rate and a frequency of 2.19, the West Texas audience is seeing the ads multiple times and actively engaging. The $719.19 in spend covers a partial month, which makes the lead volume even more significant.",
    },
    ga4: {
      headline: "98.6% Engagement Across 430 Sessions",
      body: "The website held a 98.6% engagement rate, the highest quality traffic the site has seen to date. Paid Social became the top traffic source, and the roof inspection page captured 60% of all visits.",
    },
  },
  section_notes: {
    content:
      "Short-form video led engagement across platforms. On Instagram, Reels captured the large majority of views, while on Facebook, Link Posts and Reels drove 75% of all audience interaction.",
    demographics:
      "The audience aligns with homeowners and property decision makers in the West Texas market, and is nearly evenly split by gender: 50.6% men and 49.4% women.",
    discovery:
      "On Facebook, 58% of views came from the Feed and 36.4% from Reels, showing strong algorithmic discovery. On Instagram, 58.5% of views came from non-followers, confirming the content is reaching beyond the existing audience.",
    video:
      "Reels remain the strongest format: 1,400 Instagram Reels views and 35% of all Facebook engagement.",
  },
  conclusion: [
    "July 2026 was a transformative month for Wieler Roofing. The decision to pivot from Google Ads to Meta Ads on July 14 produced immediate, high-impact results across every digital channel, driving a 5,800% increase in Facebook visibility and making Paid Social the leading source of highly engaged website traffic.",
    "The website maintained an exceptional 98.6% engagement rate, with the roof inspection page capturing 60% of all site traffic. Instagram grew steadily to 213 followers, with Reels driving the majority of views and \"Welcome to West Texas\" proving to be the most effective organic post. Across all platforms, the data confirms that the move to Meta Ads has elevated the brand's digital presence in the West Texas market.",
  ].join("\n\n"),
};

export const ANNOTATIONS = [
  {
    date: "2026-07-14",
    label: "Moved budget from Google Ads to Meta Ads",
    description: "Full paid budget shifted to a Meta lead generation campaign targeting West Texas.",
  },
];
