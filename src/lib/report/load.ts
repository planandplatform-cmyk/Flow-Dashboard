import "server-only";
/**
 * Everything the report shows, computed once from the URL. The web page and
 * the PDF export both render from this, so their numbers always match.
 */
import {
  getAdCampaigns,
  getAnnotations,
  getAudienceSnapshots,
  getCommentary,
  getLatestDataDate,
  getLatestPublishedMonth,
  getMetricData,
  getPostCounts,
  getTopPosts,
  type AudienceSnapshot,
  type Client,
} from "@/lib/data/portal";
import { formatDay, isValidMonthParam, monthOf, todayIn } from "@/lib/dates";
import { compare, MetricResolver, onlyEnabledSources, type DateRange } from "@/lib/metrics/aggregate";
import { METRICS, SOCIAL_OVERVIEW_KEYS } from "@/lib/metrics/config";
import { SOCIAL_SOURCES, SOURCE_LABELS, type DataSource, type SocialSource } from "@/lib/metrics/types";
import { compareWindow, PRESETS, resolvePeriod } from "./period";
import { buildSocial, NOT_AVAILABLE } from "./social";
import { buildTrends, metricDependencies, TREND_KEYS, trendFetchRange, trendMonths } from "./trends";

/** Three headline tiles per platform, as in the monthly report. */
export const PLATFORM_TILES: Record<SocialSource, { keys: [string, string, string]; headline: [string, string] }> = {
  meta_facebook: { keys: ["fb_followers", "fb_reactions", "fb_page_visits"], headline: ["fb_views", "fb_interactions"] },
  meta_instagram: { keys: ["ig_followers", "ig_reels_views", "ig_profile_visits"], headline: ["ig_views", "ig_interactions"] },
  tiktok: { keys: ["tt_followers", "tt_views", "tt_profile_views"], headline: ["tt_views", "tt_interactions"] },
  linkedin: { keys: ["li_followers", "li_impressions", "li_page_views"], headline: ["li_impressions", "li_interactions"] },
};

/** Candidates for the month-over-month grid; only ones with data are shown. */
export const MOM_KEYS = [
  "fb_views",
  "fb_page_visits",
  "fb_interactions",
  "ig_followers",
  "ig_views",
  "ig_interactions",
  "ig_profile_visits",
  "tt_views",
  "li_impressions",
  "li_page_views",
  "ga4_sessions",
  "ga4_key_events",
  "ga4_engagement_rate",
  "ga4_avg_engagement_time",
  "ga4_revenue",
  "ga4_transactions",
  "gsc_clicks",
  "gsc_impressions",
  "gsc_position",
  "gads_conversions",
  "gads_clicks",
  "gads_cpa",
  "shop_total_sales",
  "shop_orders",
];

export const ADS_TABLE: { key: string; meaning: string }[] = [
  { key: "ads_leads", meaning: "People who completed the lead form after seeing the ad" },
  { key: "ads_spend", meaning: "Total ad spend across the campaign period" },
  { key: "ads_reach", meaning: "Number of different people who saw the ads at least once" },
  { key: "ads_frequency", meaning: "Average number of times each person saw the ads" },
  { key: "ads_ctr", meaning: "Share of people who clicked the ad after seeing it" },
  { key: "ads_cpl", meaning: "Average cost for each lead the campaign generated" },
];

/** Google Ads metrics table: metric and what it means. */
export const GOOGLE_ADS_TABLE: { key: string; meaning: string }[] = [
  { key: "gads_conversions", meaning: "Calls, form fills, or other actions counted as conversions" },
  { key: "gads_spend", meaning: "Total spent on Google Ads in the period" },
  { key: "gads_clicks", meaning: "Times people clicked an ad" },
  { key: "gads_impressions", meaning: "Times the ads were shown" },
  { key: "gads_ctr", meaning: "Share of people who clicked after seeing an ad" },
  { key: "gads_cpc", meaning: "Average cost of each click" },
  { key: "gads_conversion_rate", meaning: "Share of clicks that became a conversion" },
  { key: "gads_cpa", meaning: "Average cost of each conversion" },
  { key: "gads_conversion_value", meaning: "Value of the conversions, where tracked" },
  { key: "gads_roas", meaning: "Conversion value for every dollar spent" },
  { key: "gads_impression_share", meaning: "Share of eligible searches where the ad showed" },
  { key: "gads_top_of_page_rate", meaning: "How often the ad showed above the search results" },
  { key: "gads_abs_top_rate", meaning: "How often the ad was the very first result" },
];

/** Short auction insights column headings. */
export const AUCTION_LABELS: Record<string, string> = {
  gads_impression_share: "Impr. Share",
  gads_overlap_rate: "Overlap",
  gads_position_above_rate: "Position Above",
  gads_top_of_page_rate: "Top of Page",
  gads_abs_top_rate: "Abs. Top",
  gads_outranking_share: "Outranking",
};

/** Auction insights columns, in Google's order. */
export const AUCTION_KEYS = [
  "gads_impression_share",
  "gads_overlap_rate",
  "gads_position_above_rate",
  "gads_top_of_page_rate",
  "gads_abs_top_rate",
  "gads_outranking_share",
] as const;

/** Website visitor breakdowns from GA4, in display order. */
export const WEBSITE_AUDIENCE: { type: string; title: string }[] = [
  { type: "age", title: "Visitors by age" },
  { type: "gender", title: "Visitors by gender" },
  { type: "device", title: "Visitors by device" },
  { type: "country", title: "Top countries" },
  { type: "city", title: "Top cities" },
];

/** Short column headings for website tables. */
export const WEBSITE_COLUMNS: Record<string, string> = {
  ga4_sessions: "Sessions",
  ga4_page_views: "Views",
  ga4_engagement_rate: "Engagement",
  ga4_avg_engagement_time: "Avg. Engagement",
  ga4_key_events: "Key Events",
  ga4_revenue: "Sales",
};

export const FORMAT_LABELS: Record<string, string> = {
  reel: "Reel",
  photo: "Photo Post",
  carousel: "Carousel",
  link: "Link Post",
  video: "Video",
  story: "Story",
  text: "Text Post",
  other: "Other",
};

export function snapshotsOf(snaps: AudienceSnapshot[], platform: DataSource, type: string) {
  return snaps.filter((s) => s.platform === platform && s.breakdown_type === type);
}

/** Audience breakdowns shown in the demographics section, with their titles. */
export const DEMOGRAPHICS: { type: string; title: string; sortByBucket?: boolean }[] = [
  { type: "age", title: "age range", sortByBucket: true },
  { type: "gender", title: "gender" },
  { type: "country", title: "top countries" },
  { type: "city", title: "top cities" },
  { type: "language", title: "top languages" },
  { type: "job_function", title: "job function" },
  { type: "seniority", title: "seniority" },
  { type: "industry", title: "industry" },
  { type: "company_size", title: "company size" },
];

/** Video and short-form tiles, shown when the platform supplied them. */
export const VIDEO_KEYS = [
  "fb_reels_views",
  "fb_watch_time",
  "fb_3s_views",
  "fb_1min_views",
  "ig_reels_views",
  "ig_reels_interactions",
  "fb_reels_engagement_share",
];

export const videoLabel = (key: string) => `${METRICS[key].source === "meta_instagram" ? "Instagram" : "Facebook"} ${METRICS[key].label}`;

type Search = Record<string, string | string[] | undefined>;

export async function loadReport(client: Client, search: Search, opts: { publishedOnly?: boolean } = {}) {
  const today = todayIn(client.timezone);
  const thisMonth = monthOf(today);

  // Default landing: the latest month with published commentary, else the
  // latest month with data. Only looked up when the URL does not say.
  const needsDefault = !PRESETS.some((p) => p.id === search.range) && !isValidMonthParam(search.month);
  let defaultMonth = thisMonth;
  if (needsDefault) {
    const [published, latestData] = await Promise.all([getLatestPublishedMonth(client.id), getLatestDataDate(client.id)]);
    defaultMonth = published ?? (latestData ? monthOf(latestData) : thisMonth);
  }
  const period = resolvePeriod(search, { today, defaultMonth });
  const { range, compareRange } = period;
  const enabled = new Set(client.enabled_sources);

  // For a calendar month the ads section follows the PDF report: it covers the
  // full window of every campaign that ran during the month, even past month
  // end. For any other range it covers the range itself.
  const campaigns = enabled.has("meta_ads") ? await getAdCampaigns(client.id, range) : [];
  const adsRange: DateRange | null = !campaigns.length
    ? null
    : period.month
      ? {
          start: campaigns.map((c) => c.start_date ?? range.start).sort()[0],
          end: campaigns.map((c) => c.end_date ?? range.end).sort().at(-1)!,
        }
      : range;
  const adsCompare = adsRange ? compareWindow(period, adsRange) : null;

  const windows = [range, compareRange, adsRange, adsCompare].filter((r): r is DateRange => r !== null);
  const fetchRange: DateRange = {
    start: windows.map((r) => r.start).sort()[0],
    end: windows.map((r) => r.end).sort().at(-1)!,
  };

  // Trend charts: 12 months (and the year before) of the key metrics, totals only.
  const months = trendMonths(range);
  const trendRange = trendFetchRange(months);
  const trendKeys = TREND_KEYS.filter((k) => METRICS[k].source === "combined" || enabled.has(METRICS[k].source));
  const annotationRange: DateRange = { start: [months[0], range.start].sort()[0], end: [trendRange.end, range.end].sort().at(-1)! };

  const [allData, trendData, rawCommentary, allPosts, allSnapshots, allAnnotations] = await Promise.all([
    getMetricData(client.id, fetchRange),
    getMetricData(client.id, trendRange, { keys: metricDependencies(trendKeys), totalsOnly: true }),
    period.month ? getCommentary(client.id, period.month) : Promise.resolve(null),
    getTopPosts(client.id, range, 8),
    getAudienceSnapshots(client.id, range),
    getAnnotations(client.id, annotationRange),
  ]);

  // Only the client's turned-on channels appear anywhere in the report,
  // including combined totals, even if older data exists for others.
  const data = onlyEnabledSources(allData, enabled);
  // The PDF is for sending to clients, so it never includes draft commentary.
  const commentary = opts.publishedOnly && rawCommentary?.status !== "published" ? null : rawCommentary;
  const posts = allPosts.filter((p) => enabled.has(p.platform));
  const snapshots = allSnapshots.filter((s) => enabled.has(s.platform));
  const annotations = allAnnotations.filter((a) => a.date >= range.start && a.date <= range.end);

  // A single month never shows a cut-down slice of a platform total; custom
  // ranges do, flagged as estimates.
  const resolver = new MetricResolver(data, { prorate: !period.month });
  const val = (key: string, r: DateRange = range) => resolver.resolve(key, r).value;
  // Combined totals are only compared when the same platforms are in both periods.
  const comparable = (key: string) => {
    const agg = METRICS[key]?.aggregation;
    if (agg?.type !== "derived_sum" || !compareRange) return true;
    return agg.of.every((part) => (val(part) === null) === (val(part, compareRange) === null));
  };
  const mom = (key: string) => (compareRange && comparable(key) ? compare(key, val(key), val(key, compareRange)) : null);
  const adsCmp = (key: string) => (adsRange && adsCompare ? compare(key, val(key, adsRange), val(key, adsCompare)) : null);

  const enabledSocial = SOCIAL_SOURCES.filter((s) => enabled.has(s));
  const postCounts = enabledSocial.length ? await getPostCounts(client.id, range, enabledSocial) : {};
  const social = buildSocial({
    resolver,
    data,
    range,
    compareRange,
    compareLabel: period.compareLabel,
    enabled: enabledSocial,
    narratives: commentary?.platform_narratives ?? {},
    snapshots,
    postCounts,
  });
  const socials = social.platforms.map((p) => p.source);
  const narratives = commentary?.platform_narratives ?? {};
  const notes = commentary?.section_notes ?? {};
  const hasWebsite = enabled.has("ga4") && val("ga4_sessions") !== null;
  // Time on site and online sales only show when GA4 has them (sales: online stores).
  const hasTime = hasWebsite && val("ga4_avg_engagement_time") !== null;
  const hasSales = hasWebsite && (val("ga4_revenue") ?? 0) > 0;
  const websiteTiles = ["ga4_sessions", "ga4_engagement_rate", ...(hasTime ? ["ga4_avg_engagement_time"] : []), "ga4_key_events"];
  const salesTiles = hasSales ? ["ga4_revenue", "ga4_transactions", "ga4_aov", "ga4_purchase_rate"] : [];
  const websiteTable = (by: string, dimension: string, extra: string[], limit: number) => {
    const keys = [by, ...extra.filter((k) => (k !== "ga4_avg_engagement_time" || hasTime) && (k !== "ga4_revenue" || hasSales))];
    const rows = hasWebsite
      ? resolver
          .breakdown(by, dimension, range)
          .slice(0, limit)
          .map(({ bucket, value }) => ({
            name: bucket,
            // No sales from a channel or page is $0, not missing.
            values: [value, ...keys.slice(1).map((k) => resolver.resolve(k, range, { dimension, value: bucket }).value ?? (k === "ga4_revenue" ? 0 : null))],
          }))
      : [];
    return { keys, rows };
  };
  const websiteChannels = websiteTable("ga4_sessions", "channel", ["ga4_engagement_rate", "ga4_avg_engagement_time", "ga4_key_events", "ga4_revenue"], 10);
  const websitePages = websiteTable("ga4_page_views", "landing_page", ["ga4_engagement_rate", "ga4_avg_engagement_time", "ga4_key_events", "ga4_revenue"], 8);
  // Who visited the website (GA4), for the months in this range.
  const websiteAudience = hasWebsite
    ? WEBSITE_AUDIENCE.map((d) => ({
        ...d,
        items: snapshotsOf(snapshots, "ga4", d.type)
          .filter((x) => x.snapshot_date >= range.start)
          .sort((a, b) => (d.type === "age" ? a.bucket.localeCompare(b.bucket) : b.share - a.share)),
      })).filter((d) => d.items.length > 0)
    : [];
  // Google Search (Search Console): rankings for the search terms people used.
  const hasSearch = enabled.has("search_console") && val("gsc_impressions") !== null;
  const searchTable = (dimension: "query" | "page", limit: number) =>
    hasSearch
      ? resolver
          .breakdown("gsc_clicks", dimension, range)
          .slice(0, limit)
          .map(({ bucket, value }) => {
            const f = { dimension, value: bucket };
            return {
              name: bucket,
              clicks: value,
              impressions: resolver.resolve("gsc_impressions", range, f).value,
              ctr: resolver.resolve("gsc_ctr", range, f).value,
              position: resolver.resolve("gsc_position", range, f).value,
            };
          })
      : [];
  const searchQueries = searchTable("query", 15);
  const searchPages = searchTable("page", 10);
  const hasAds = adsRange !== null && val("ads_spend", adsRange) !== null;
  const hasGoogleAds = enabled.has("google_ads") && (val("gads_spend") !== null || val("gads_clicks") !== null);
  const googleCampaigns = hasGoogleAds
    ? resolver.breakdown("gads_spend", "campaign", range).map(({ bucket, value }) => {
        const f = { dimension: "campaign", value: bucket };
        return {
          name: bucket,
          spend: value,
          clicks: resolver.resolve("gads_clicks", range, f).value,
          conversions: resolver.resolve("gads_conversions", range, f).value,
          cpa: resolver.resolve("gads_cpa", range, f).value,
        };
      })
    : [];
  // Top search terms and keywords, by clicks, when those reports were uploaded.
  const googleTop = (dimension: "search_term" | "keyword") =>
    hasGoogleAds
      ? resolver
          .breakdown("gads_clicks", dimension, range)
          .slice(0, 10)
          .map(({ bucket, value }) => {
            const f = { dimension, value: bucket };
            return {
              name: bucket,
              clicks: value,
              impressions: resolver.resolve("gads_impressions", range, f).value,
              spend: resolver.resolve("gads_spend", range, f).value,
              conversions: resolver.resolve("gads_conversions", range, f).value,
            };
          })
      : [];
  // Auction insights: the account's own row first, then competitors by impression share.
  const auctionRow = (filter?: { dimension: string; value: string }) => AUCTION_KEYS.map((k) => resolver.resolve(k, range, filter).value);
  const competitorNames = hasGoogleAds ? [...new Set(AUCTION_KEYS.flatMap((k) => resolver.breakdown(k, "competitor", range).map((b) => b.bucket)))] : [];
  const googleAuction =
    hasGoogleAds && (auctionRow().some((v) => v !== null) || competitorNames.length)
      ? [
          { name: "You", you: true, values: auctionRow() },
          ...competitorNames
            .map((name) => ({ name, you: false, values: auctionRow({ dimension: "competitor", value: name }) }))
            .sort((a, b) => (b.values[0] ?? 0) - (a.values[0] ?? 0)),
        ]
      : [];
  // Who saw the ads (Google Ads demographics), shown in the Google Ads section.
  const googleDemographics = hasGoogleAds
    ? (["age", "gender"] as const)
        .map((type) => ({
          type,
          title: type === "age" ? "Ad impressions by age" : "Ad impressions by gender",
          items: snapshotsOf(snapshots, "google_ads", type).sort((a, b) => (type === "age" ? a.bucket.localeCompare(b.bucket) : b.share - a.share)),
        }))
        .filter((d) => d.items.length > 0)
    : [];
  const googleSearchTerms = googleTop("search_term");
  const googleKeywords = googleTop("keyword");
  const momKeys = compareRange ? MOM_KEYS.filter((k) => val(k) !== null && val(k, compareRange) !== null) : [];

  const trends = buildTrends(new MetricResolver(onlyEnabledSources(trendData, enabled), { prorate: false }), trendKeys, months, today, (k) => {
    const def = METRICS[k];
    return def.source === "combined" ? def.label : `${SOURCE_LABELS[def.source]} ${def.label}`;
  });
  const trendGroups = [
    { id: "combined", label: "Combined", keys: trends.filter((t) => t.source === "combined").map((t) => t.key) },
    ...client.enabled_sources.map((src) => ({ id: src, label: SOURCE_LABELS[src], keys: trends.filter((t) => t.source === src).map((t) => t.key) })),
  ].filter((g) => g.keys.length > 0);
  const chartAnnotations = allAnnotations.map((a) => ({ month: monthOf(a.date), date: a.date, label: `${formatDay(a.date)}: ${a.label}` }));

  const showContent = posts.length > 0 || social.contentTypes.length > 0 || snapshots.some((s) => s.breakdown_type === "format_engagement");
  const showAudience = snapshots.some((s) => (SOCIAL_SOURCES as readonly string[]).includes(s.platform) && DEMOGRAPHICS.some((d) => d.type === s.breakdown_type));
  const showDiscovery = social.discovery.some((d) => d.activity[0] !== NOT_AVAILABLE || d.split[0] !== NOT_AVAILABLE);
  const showVideo = VIDEO_KEYS.some((k) => val(k) !== null);

  const nav = [
    { id: "summary", label: "Summary", show: true },
    // Social media terms only when the client has a social channel turned on.
    { id: "terms", label: "Key terms", show: enabledSocial.length > 0 },
    { id: "social", label: "Social", show: socials.length > 0 },
    { id: "platforms", label: "Platforms", show: socials.length > 0 },
    { id: "website", label: "Website", show: hasWebsite },
    { id: "google-search", label: "Google Search", show: hasSearch },
    { id: "content", label: "Content", show: showContent },
    { id: "audience", label: "Audience", show: showAudience },
    { id: "discovery", label: "Discovery", show: showDiscovery },
    { id: "video", label: "Video", show: showVideo },
    { id: "ads", label: "Meta Ads", show: hasAds },
    { id: "google-ads", label: "Google Ads", show: hasGoogleAds },
    { id: "mom", label: "Comparison", show: compareRange !== null && (momKeys.length > 0 || social.compareCards.length > 0) },
    { id: "trends", label: "Trends", show: trends.length > 0 },
  ].filter((n) => n.show);

  const compareTitle =
    period.compareMode === "yoy"
      ? "Year-over-Year Comparison"
      : period.compareMode === "previous" && period.month
        ? "Month-over-Month Comparison"
        : "Period Comparison";



  // Combined totals cover social media only, so they appear only when a social
  // channel has numbers, and say so in the label.
  const reachParts = socials
    .filter((s) => s !== "linkedin" && val(SOCIAL_OVERVIEW_KEYS[s].views) !== null)
    .map((s) => `${SOURCE_LABELS[s]} ${METRICS[SOCIAL_OVERVIEW_KEYS[s].views].label}`);
  const interactionParts = socials.filter((s) => val(SOCIAL_OVERVIEW_KEYS[s].interactions) !== null).map((s) => SOURCE_LABELS[s]);
  const heroTiles = [
    ...(reachParts.length ? [{ key: "total_audience_reach", label: "Social Media Reach", caption: `Social only: ${reachParts.join(" + ")}` }] : []),
    ...(interactionParts.length
      ? [{ key: "total_interactions", label: "Social Media Interactions", caption: `Social only: ${interactionParts.join(" + ")} engagement` }]
      : []),
    ...(hasWebsite ? [{ key: "ga4_engagement_rate", caption: "Website visits that engaged", label: "Website Engagement" }] : []),
    ...(hasSearch ? [{ key: "gsc_clicks", caption: "Clicks from unpaid Google results", label: "Google Search Clicks" }] : []),
  ].slice(0, 3) as { key: string; caption: string; label?: string }[];

  return {
    client,
    today,
    thisMonth,
    period,
    range,
    compareRange,
    campaigns,
    adsRange,
    adsCompare,
    commentary,
    narratives,
    notes,
    resolver,
    val,
    mom,
    adsCmp,
    posts,
    snapshots,
    annotations,
    socials,
    social,
    hasWebsite,
    websiteTiles,
    salesTiles,
    websiteChannels,
    websitePages,
    websiteAudience,
    hasSearch,
    searchQueries,
    searchPages,
    hasAds,
    hasGoogleAds,
    googleCampaigns,
    googleSearchTerms,
    googleAuction,
    googleDemographics,
    googleKeywords,
    momKeys,
    months,
    trends,
    trendGroups,
    chartAnnotations,
    show: { terms: enabledSocial.length > 0, content: showContent, audience: showAudience, discovery: showDiscovery, video: showVideo },
    nav,
    compareTitle,
    heroTiles,
  };
}

export type Report = Awaited<ReturnType<typeof loadReport>>;
