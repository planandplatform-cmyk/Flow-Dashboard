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
  getTopPosts,
  type AudienceSnapshot,
  type Client,
} from "@/lib/data/portal";
import { formatDay, isValidMonthParam, monthOf, todayIn } from "@/lib/dates";
import { compare, MetricResolver, onlyEnabledSources, type DateRange } from "@/lib/metrics/aggregate";
import { METRICS, SOCIAL_OVERVIEW_KEYS } from "@/lib/metrics/config";
import { SOCIAL_SOURCES, SOURCE_LABELS, type DataSource, type SocialSource } from "@/lib/metrics/types";
import { compareWindow, PRESETS, resolvePeriod } from "./period";
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
  "fb_interactions",
  "ig_followers",
  "ig_views",
  "ig_interactions",
  "tt_views",
  "li_impressions",
  "ga4_sessions",
  "ga4_key_events",
  "ga4_engagement_rate",
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

  const resolver = new MetricResolver(data);
  const val = (key: string, r: DateRange = range) => resolver.resolve(key, r).value;
  const mom = (key: string) => (compareRange ? compare(key, val(key), val(key, compareRange)) : null);
  const adsCmp = (key: string) => (adsRange && adsCompare ? compare(key, val(key, adsRange), val(key, adsCompare)) : null);

  const socials = SOCIAL_SOURCES.filter((s) => enabled.has(s) && val(SOCIAL_OVERVIEW_KEYS[s].views) !== null);
  const narratives = commentary?.platform_narratives ?? {};
  const notes = commentary?.section_notes ?? {};
  const hasWebsite = enabled.has("ga4") && val("ga4_sessions") !== null;
  const hasAds = adsRange !== null && val("ads_spend", adsRange) !== null;
  const momKeys = compareRange ? MOM_KEYS.filter((k) => val(k) !== null && val(k, compareRange) !== null) : [];

  const trends = buildTrends(new MetricResolver(onlyEnabledSources(trendData, enabled)), trendKeys, months, today, (k) => {
    const def = METRICS[k];
    return def.source === "combined" ? def.label : `${SOURCE_LABELS[def.source]} ${def.label}`;
  });
  const trendGroups = [
    { id: "combined", label: "Combined", keys: trends.filter((t) => t.source === "combined").map((t) => t.key) },
    ...client.enabled_sources.map((src) => ({ id: src, label: SOURCE_LABELS[src], keys: trends.filter((t) => t.source === src).map((t) => t.key) })),
  ].filter((g) => g.keys.length > 0);
  const chartAnnotations = allAnnotations.map((a) => ({ month: monthOf(a.date), date: a.date, label: `${formatDay(a.date)}: ${a.label}` }));

  const showContent = (posts.length > 0 || snapshotsOf(snapshots, "meta_facebook", "format_engagement").length > 0);
  const showAudience = snapshots.some((s) => ["age", "gender", "country", "language"].includes(s.breakdown_type));
  const showDiscovery = snapshots.some((s) => ["discovery_surface", "follower_status"].includes(s.breakdown_type));
  const showVideo = (val("ig_reels_views") !== null || val("fb_reels_interactions") !== null);

  const nav = [
    { id: "summary", label: "Summary", show: true },
    { id: "terms", label: "Key terms", show: true },
    { id: "social", label: "Social", show: socials.length > 0 },
    { id: "platforms", label: "Platforms", show: socials.length > 0 },
    { id: "website", label: "Website", show: hasWebsite },
    { id: "content", label: "Content", show: showContent },
    { id: "audience", label: "Audience", show: showAudience },
    { id: "discovery", label: "Discovery", show: showDiscovery },
    { id: "video", label: "Video", show: showVideo },
    { id: "ads", label: "Ads", show: hasAds },
    { id: "mom", label: "Comparison", show: momKeys.length > 0 },
    { id: "trends", label: "Trends", show: trends.length > 0 },
  ].filter((n) => n.show);

  const compareTitle =
    period.compareMode === "yoy"
      ? "Year-over-Year Comparison"
      : period.compareMode === "previous" && period.month
        ? "Month-over-Month Comparison"
        : "Period Comparison";



  const heroTiles = [
    { key: "total_audience_reach", caption: socials.map((s) => `${SOURCE_LABELS[s]} ${METRICS[SOCIAL_OVERVIEW_KEYS[s].views].label}`).join(" + ") },
    { key: "total_interactions", caption: socials.map((s) => SOURCE_LABELS[s]).join(" + ") + " engagement" },
    ...(hasWebsite ? [{ key: "ga4_engagement_rate", caption: "Website visits that engaged", label: "Website Engagement" }] : []),
  ] as { key: string; caption: string; label?: string }[];

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
    hasWebsite,
    hasAds,
    momKeys,
    months,
    trends,
    trendGroups,
    chartAnnotations,
    show: { content: showContent, audience: showAudience, discovery: showDiscovery, video: showVideo },
    nav,
    compareTitle,
    heroTiles,
  };
}

export type Report = Awaited<ReturnType<typeof loadReport>>;
