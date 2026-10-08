/**
 * The social media sections, laid out like FFM's monthly social report: each
 * platform keeps its own metric names and source period, nothing is blended
 * across platforms that measure differently, and anything missing is stated
 * as "Not available in supplied data". Pure, so the rules are unit tested.
 */
import { formatDay, formatRange } from "@/lib/dates";
import { compare, type Comparison, type DateRange, type MetricData, type MetricResolver } from "@/lib/metrics/aggregate";
import { METRICS } from "@/lib/metrics/config";
import { formatDelta, formatMetric, formatPctChange } from "@/lib/metrics/format";
import { SOCIAL_SOURCES, SOURCE_LABELS, type SocialSource } from "@/lib/metrics/types";

export const NOT_AVAILABLE = "Not available";

/** Platform brand colors, used only for platform labels and bars. */
export const PLATFORM_COLORS: Record<SocialSource, string> = {
  meta_instagram: "#d6249f",
  meta_facebook: "#1877f2",
  linkedin: "#0a66c2",
  tiktok: "#fe2c55",
};

interface PlatformSpec {
  /** Candidates for the four tiles, in order of preference. */
  tiles: string[];
  /** Metrics the report expects; missing ones are listed under the card. */
  core: string[];
  followers: string;
  netNew: string;
  /** The platform's own visibility measures, in its own names. */
  visibility: string[];
  engagement: string;
  activity: string[];
}

const SPECS: Record<SocialSource, PlatformSpec> = {
  meta_instagram: {
    tiles: ["ig_views", "ig_interactions", "ig_net_new_followers", "ig_profile_visits", "ig_followers", "ig_reach", "ig_viewers", "ig_reels_views"],
    core: ["ig_followers", "ig_reach", "ig_views", "ig_interactions", "ig_profile_visits"],
    followers: "ig_followers",
    netNew: "ig_net_new_followers",
    visibility: ["ig_views", "ig_viewers", "ig_reach"],
    engagement: "ig_interactions",
    activity: ["ig_profile_visits", "ig_bio_link_taps", "ig_address_taps"],
  },
  meta_facebook: {
    tiles: ["fb_views", "fb_interactions", "fb_page_visits", "fb_followers", "fb_net_new_followers", "fb_reach", "fb_3s_views", "fb_watch_time"],
    core: ["fb_followers", "fb_reach", "fb_views", "fb_interactions", "fb_page_visits"],
    followers: "fb_followers",
    netNew: "fb_net_new_followers",
    visibility: ["fb_views", "fb_reach"],
    engagement: "fb_interactions",
    activity: ["fb_page_visits"],
  },
  linkedin: {
    tiles: ["li_page_views", "li_unique_visitors", "li_impressions", "li_interactions", "li_followers", "li_net_new_followers", "li_button_clicks"],
    core: ["li_followers", "li_impressions", "li_interactions", "li_page_views"],
    followers: "li_followers",
    netNew: "li_net_new_followers",
    visibility: ["li_impressions", "li_page_views", "li_unique_visitors"],
    engagement: "li_interactions",
    activity: ["li_page_views", "li_unique_visitors", "li_button_clicks"],
  },
  tiktok: {
    tiles: ["tt_views", "tt_interactions", "tt_followers", "tt_profile_views", "tt_net_new_followers"],
    core: ["tt_followers", "tt_views", "tt_interactions", "tt_profile_views"],
    followers: "tt_followers",
    netNew: "tt_net_new_followers",
    visibility: ["tt_views"],
    engagement: "tt_interactions",
    activity: ["tt_profile_views"],
  },
};

/** Instagram supplies Views and Interactions per content type as counts. */
const IG_CONTENT_TYPES = [
  { label: "Reels", views: "ig_reels_views", interactions: "ig_reels_interactions" },
  { label: "Posts", views: "ig_post_views", interactions: "ig_post_interactions" },
  { label: "Stories", views: "ig_story_views", interactions: "ig_story_interactions" },
  { label: "Live videos", views: "ig_live_views", interactions: "ig_live_interactions" },
];

export interface Tile {
  key: string;
  label: string;
  /** The number shown (a separately dated total when the period has none). */
  numeric: number;
  value: string;
  caption: string | null;
  comparison: Comparison | null;
}

export interface PlatformBlock {
  source: SocialSource;
  label: string;
  color: string;
  headline: string;
  body: string | null;
  tiles: Tile[];
  /** "Followers, Reach were not available in supplied data." */
  missingNote: string | null;
  /** Dates the platform's numbers cover, when they differ from the report period. */
  sourcePeriod: string | null;
}

export interface OverviewRow {
  source: SocialSource;
  label: string;
  period: string;
  audience: string;
  netNew: string;
  visibility: string;
  engagement: string;
  posts: string;
}

export interface Bar {
  label: string;
  value: number;
  display: string;
  color: string;
}

export interface DiscoveryRow {
  source: SocialSource;
  label: string;
  activity: string[];
  split: string[];
  period: string;
}

export interface CompareCard {
  source: SocialSource;
  label: string;
  color: string;
  headline: { text: string; comparison: Comparison } | null;
  lines: { label: string; text: string; comparison: Comparison | null }[];
}

/** LinkedIn's Competitors analytics: one row per company. */
export const COMPETITOR_COLUMNS = [
  { metric: "followers", label: "Total Followers" },
  { metric: "new_followers", label: "New Followers" },
  { metric: "posts", label: "Posts" },
  { metric: "engagements", label: "Engagements" },
] as const;

export interface CompetitorTable {
  period: string;
  columns: { metric: string; label: string }[];
  rows: {
    rank: number;
    company: string;
    own: boolean;
    cells: Record<string, { value: string; change: number | null } | null>;
  }[];
}

export interface SocialModel {
  platforms: PlatformBlock[];
  overview: OverviewRow[];
  combined: { views: string; interactions: string; note: string } | null;
  visibilityBars: Bar[];
  visibilityNote: string | null;
  contentTypes: { title: string; bars: Bar[]; note: string | null }[];
  discovery: DiscoveryRow[];
  compareCards: CompareCard[];
  limitations: string[];
  sourceNotes: { label: string; text: string }[];
  competitors: CompetitorTable | null;
}

export interface SocialInput {
  resolver: MetricResolver;
  data: MetricData;
  range: DateRange;
  compareRange: DateRange | null;
  compareLabel: string | null;
  enabled: SocialSource[];
  narratives: Partial<Record<string, { headline?: string; body?: string }>>;
  snapshots: { platform: string; breakdown_type: string; bucket: string; share: number }[];
  postCounts: Partial<Record<SocialSource, number>>;
}

const pct = (share: number) => `${(share * 100).toFixed(1).replace(/\.0$/, "")}%`;

export function buildSocial(input: SocialInput): SocialModel {
  const { resolver, range, compareRange } = input;
  const get = (key: string, r: DateRange = range) => resolver.resolve(key, r);
  const value = (key: string) => get(key).value;
  const cmp = (key: string) => (compareRange ? compare(key, value(key), get(key, compareRange).value) : null);
  const has = (key: string) => value(key) !== null;

  /**
   * A platform total for a different stretch of time that overlaps the period
   * (LinkedIn content analytics for Jul 31 to Aug 4, in a July report). It is
   * shown with its own dates and never added into the period's numbers.
   */
  const separate = (key: string): { value: number; period: string } | null => {
    if (has(key)) return null;
    const rows = input.data.period.filter(
      (r) => r.metric_key === key && !r.dimension && r.period_start <= range.end && r.period_end >= range.start,
    );
    return rows.length === 1 ? { value: rows[0].value, period: formatRange({ start: rows[0].period_start, end: rows[0].period_end }) } : null;
  };
  const shown = (key: string) => has(key) || separate(key) !== null;
  const fmt = (key: string) => formatMetric(key, value(key));
  const named = (key: string) => `${fmt(key)} ${METRICS[key].label}`;

  // Platforms with any data at all in the period.
  const socials = SOCIAL_SOURCES.filter((s) => input.enabled.includes(s) && Object.values(METRICS).some((m) => m.source === s && has(m.key)));

  /** The platform's own dates, when they differ from the report period. */
  const sourcePeriodOf = (s: SocialSource): string | null => {
    const periods = new Set<string>();
    for (const m of Object.values(METRICS)) {
      if (m.source !== s) continue;
      const sp = get(m.key).sourcePeriod;
      if (sp) periods.add(formatRange(sp));
    }
    return periods.size ? [...periods].join("; ") : null;
  };
  const periodLabel = (s: SocialSource) => sourcePeriodOf(s) ?? formatRange(range);

  const platforms: PlatformBlock[] = socials.map((s) => {
    const spec = SPECS[s];
    const tileKeys = spec.tiles.filter(shown).slice(0, 4);
    const tiles = tileKeys.map((key): Tile => {
      const sep = separate(key);
      const c = sep ? null : cmp(key);
      let caption: string | null = sep ? `${sep.period} only` : null;
      if (key === "ig_interactions") {
        const parts = IG_CONTENT_TYPES.filter((t) => has(t.interactions)).map((t) => `${t.label} ${fmt(t.interactions)}`);
        if (parts.length) caption = parts.join("; ");
      }
      if (key === spec.netNew && has(spec.followers)) caption = `${named(spec.followers)} at period end`;
      if (key === "ig_profile_visits" && has("ig_bio_link_taps")) caption = `Bio link taps: ${fmt("ig_bio_link_taps")}`;
      if (key === "fb_3s_views" && has("fb_1min_views")) caption = `1-minute views: ${fmt("fb_1min_views")}`;
      const sp = get(key).sourcePeriod;
      if (!caption && sp) caption = formatRange(sp);
      const numeric = sep ? sep.value : value(key)!;
      return { key, label: METRICS[key].label, numeric, value: formatMetric(key, numeric), caption, comparison: c };
    });
    const missing = spec.core.filter((k) => !shown(k)).map((k) => METRICS[k].label);
    const narrative = input.narratives[s];
    const top = tileKeys.slice(0, 2);
    return {
      source: s,
      label: SOURCE_LABELS[s],
      color: PLATFORM_COLORS[s],
      headline: narrative?.headline ?? top.filter(has).map(named).join(", "),
      body: narrative?.body ?? null,
      tiles,
      missingNote: missing.length ? `${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not available in supplied data.` : null,
      sourcePeriod: sourcePeriodOf(s),
    };
  });

  const overview: OverviewRow[] = socials.map((s) => {
    const spec = SPECS[s];
    const net = value(spec.netNew);
    const vis = spec.visibility.filter(shown).map((k) => {
      const sep = separate(k);
      return sep ? `${formatMetric(k, sep.value)} ${METRICS[k].label} (${sep.period})` : named(k);
    });
    return {
      source: s,
      label: SOURCE_LABELS[s],
      period: periodLabel(s),
      audience: has(spec.followers) ? named(spec.followers) : NOT_AVAILABLE,
      netNew: net === null ? NOT_AVAILABLE : `${net > 0 ? "+" : ""}${formatMetric(spec.netNew, net)}`,
      visibility: vis.length ? vis.join("; ") : NOT_AVAILABLE,
      engagement: has(spec.engagement)
        ? named(spec.engagement)
        : separate(spec.engagement)
          ? `${formatMetric(spec.engagement, separate(spec.engagement)!.value)} ${METRICS[spec.engagement].label} (${separate(spec.engagement)!.period})`
          : NOT_AVAILABLE,
      posts: input.postCounts[s] ? String(input.postCounts[s]) : NOT_AVAILABLE,
    };
  });

  // Views are combined only across platforms that call them Views.
  const viewSources = socials.filter((s) => s !== "linkedin" && has(SPECS[s].visibility[0]));
  const combined =
    viewSources.length > 1
      ? {
          views: `${formatMetric("total_audience_reach", value("total_audience_reach"))} Views`,
          interactions:
            viewSources.every((s) => has(SPECS[s].engagement)) && has("total_interactions")
              ? `${formatMetric("total_interactions", value("total_interactions"))} combined`
              : NOT_AVAILABLE,
          note: `${viewSources.map((s) => SOURCE_LABELS[s]).join(" and ")} only`,
        }
      : null;

  const visibilityBars: Bar[] = socials
    .map((s) => {
      // Prefer the platform's main measure even when it covers its own dates.
      const main = SPECS[s].visibility[0];
      const key = has(main) ? main : separate(main) ? undefined : SPECS[s].visibility.find(has);
      if (key) return { label: `${SOURCE_LABELS[s]} ${METRICS[key].label}`, value: value(key)!, display: fmt(key), color: PLATFORM_COLORS[s] };
      const alt = separate(main) ? main : SPECS[s].visibility.find((k) => separate(k));
      if (!alt) return null;
      const sep = separate(alt)!;
      return { label: `${SOURCE_LABELS[s]} ${METRICS[alt].label} (${sep.period})`, value: sep.value, display: formatMetric(alt, sep.value), color: PLATFORM_COLORS[s] };
    })
    .filter((b): b is Bar => b !== null);
  const visibilityNote = socials.includes("linkedin") && shown("li_impressions")
    ? "LinkedIn reports Impressions, a different measure from Views, so it is shown for reference and not added to the combined total."
    : null;

  const contentTypes: SocialModel["contentTypes"] = [];
  if (input.enabled.includes("meta_instagram")) {
    for (const [title, field] of [
      ["Instagram Views by content type", "views"],
      ["Instagram Interactions by content type", "interactions"],
    ] as const) {
      const bars = IG_CONTENT_TYPES.filter((t) => has(t[field])).map((t) => ({
        label: t.label,
        value: value(t[field])!,
        display: fmt(t[field]),
        color: PLATFORM_COLORS.meta_instagram,
      }));
      if (bars.length >= 2) {
        const total = bars.reduce((a, b) => a + b.value, 0);
        const lead = [...bars].sort((a, b) => b.value - a.value)[0];
        contentTypes.push({ title, bars, note: total ? `${lead.label} represented ${pct(lead.value / total)} of the supplied ${field === "views" ? "Views" : "Interactions"} by content type.` : null });
      }
    }
  }
  for (const s of socials) {
    const shares = input.snapshots.filter((x) => x.platform === s && x.breakdown_type === "format_views");
    if (shares.length) {
      contentTypes.push({
        title: `${SOURCE_LABELS[s]} Views by content type`,
        bars: shares.map((x) => ({ label: x.bucket, value: x.share, display: pct(x.share), color: PLATFORM_COLORS[s] })),
        note: null,
      });
    }
  }

  const discovery: DiscoveryRow[] = socials.map((s) => {
    const activity = SPECS[s].activity.filter(has).map((k) => {
      const c = cmp(k);
      return `${named(k)}${c && c.direction !== null && c.pctChange !== null ? `, ${formatPctChange(c.pctChange)}` : ""}`;
    });
    const split = input.snapshots
      .filter((x) => x.platform === s && (x.breakdown_type === "discovery_surface" || x.breakdown_type === "follower_status"))
      .sort((a, b) => (a.breakdown_type === b.breakdown_type ? b.share - a.share : a.breakdown_type === "discovery_surface" ? -1 : 1))
      .map((x) => `${x.breakdown_type === "follower_status" ? `Views from ${x.bucket.toLowerCase()}` : x.bucket} ${pct(x.share)}`);
    return { source: s, label: SOURCE_LABELS[s], activity: activity.length ? activity : [NOT_AVAILABLE], split: split.length ? split : [NOT_AVAILABLE], period: periodLabel(s) };
  });

  const line = (label: string, key: string | undefined) => {
    if (!key || !has(key)) return { label, text: NOT_AVAILABLE, comparison: null };
    const c = cmp(key);
    const change = c && c.direction !== null ? `${c.pctChange === null ? "new" : formatPctChange(c.pctChange)} (${formatDelta(key, c.delta)})` : "no prior period supplied";
    return { label, text: `${METRICS[key].label} ${fmt(key)}, ${change}`, comparison: c && c.direction !== null ? c : null };
  };
  const compareCards: CompareCard[] = compareRange
    ? socials.map((s) => {
        const spec = SPECS[s];
        const visKey = spec.visibility.find(has);
        const lines = [
          line("Audience", has(spec.followers) ? spec.followers : spec.netNew),
          line("Visibility", visKey),
          line("Engagement", spec.engagement),
          line("Profile activity", spec.activity.find((k) => has(k) && k !== visKey)),
        ];
        const lead = lines.find((l) => l.comparison && l.comparison.pctChange !== null);
        return {
          source: s,
          label: SOURCE_LABELS[s],
          color: PLATFORM_COLORS[s],
          headline: lead ? { text: formatPctChange(lead.comparison!.pctChange), comparison: lead.comparison! } : null,
          lines,
        };
      })
    : [];

  const limitations: string[] = [];
  for (const p of platforms) {
    if (p.sourcePeriod) limitations.push(`${p.label} figures are platform totals for ${p.sourcePeriod}, as supplied, rather than exactly ${formatRange(range)}.`);
    const sepTiles = p.tiles.filter((t) => t.caption?.endsWith(" only"));
    if (sepTiles.length) {
      limitations.push(`${p.label} ${sepTiles.map((t) => t.label).join(" and ")} cover ${sepTiles[0].caption!.replace(/ only$/, "")}, a separate period, so they are not compared or combined.`);
    }
  }
  for (const c of compareCards) {
    if (!c.lines.some((l) => l.comparison)) limitations.push(`No comparable prior-period data was supplied for ${c.label}.`);
  }

  const sourceNotes = socials.map((s) => {
    const keys = new Set(Object.values(METRICS).filter((m) => m.source === s).map((m) => m.key));
    const daily = input.data.daily.filter((r) => keys.has(r.metric_key) && r.date >= range.start && r.date <= range.end);
    const periods = new Set(
      input.data.period
        .filter((r) => keys.has(r.metric_key) && r.period_start <= range.end && r.period_end >= range.start)
        .map((r) => formatRange({ start: r.period_start, end: r.period_end })),
    );
    const parts: string[] = [];
    if (daily.length) {
      const dates = daily.map((r) => r.date).sort();
      parts.push(
        dates[0] === dates.at(-1)
          ? `a reading on ${formatDay(dates[0])}`
          : `daily figures from ${formatRange({ start: dates[0], end: dates.at(-1)! })}`,
      );
    }
    if (periods.size) parts.push(`platform totals for ${[...periods].join("; ")}`);
    const text = parts.length ? `${parts.join(", plus ")}.` : "No data supplied for this period.";
    return { label: SOURCE_LABELS[s], text: text.charAt(0).toUpperCase() + text.slice(1) };
  });

  return {
    platforms,
    overview,
    combined,
    visibilityBars,
    visibilityNote,
    contentTypes,
    discovery,
    compareCards,
    limitations,
    sourceNotes,
    competitors: input.enabled.includes("linkedin") ? buildCompetitors(input) : null,
  };
}

function buildCompetitors(input: SocialInput): CompetitorTable | null {
  const { resolver, range } = input;
  const companies = new Map<string, { own: boolean; cells: CompetitorTable["rows"][number]["cells"] }>();
  const columns = COMPETITOR_COLUMNS.filter((c) => {
    let found = false;
    for (const dimension of ["own_page", "competitor"] as const) {
      for (const { bucket, value } of resolver.breakdown(`li_comp_${c.metric}`, dimension, range)) {
        found = true;
        const change = resolver.resolve(`li_comp_${c.metric}_change`, range, { dimension, value: bucket }).value;
        const row = companies.get(bucket) ?? { own: dimension === "own_page", cells: {} };
        row.cells[c.metric] = { value: formatMetric(`li_comp_${c.metric}`, value), change };
        companies.set(bucket, row);
      }
    }
    return found;
  });
  if (!columns.length) return null;

  // Rank by the most telling measure supplied: engagements, then posts, then followers.
  const sortBy = ["engagements", "posts", "new_followers", "followers"].find((m) => columns.some((c) => c.metric === m))!;
  const num = (v: string | undefined) => Number((v ?? "0").replace(/[^\d.-]/g, ""));
  const rows = [...companies]
    .map(([company, r]) => ({ company, ...r }))
    .sort((a, b) => num(b.cells[sortBy]?.value) - num(a.cells[sortBy]?.value))
    .map((r, i) => ({ rank: i + 1, company: r.company, own: r.own, cells: Object.fromEntries(columns.map((c) => [c.metric, r.cells[c.metric] ?? null])) }));

  const periods = new Set<string>();
  for (const r of input.data.period) {
    if (r.metric_key.startsWith("li_comp_") && r.period_end >= range.start && r.period_end <= range.end) {
      periods.add(formatRange({ start: r.period_start, end: r.period_end }));
    }
  }
  return { period: periods.size ? [...periods].join("; ") : formatRange(range), columns: columns.map((c) => ({ ...c })), rows };
}
