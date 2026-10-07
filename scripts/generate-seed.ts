/**
 * Generates supabase/seed.sql and the demo-mode fixture from the Wieler
 * Roofing data in scripts/seed/wieler-roofing.ts.
 *
 *   npm run seed:generate
 *
 * Monthly totals are split into whole-number daily values that add back up
 * to the exact report figures. Output is deterministic (seeded PRNG).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  AD_CAMPAIGN,
  ANNOTATIONS,
  CLIENT,
  JULY_2026,
  JULY_CHANNELS,
  JULY_COMMENTARY,
  JULY_FOLLOWERS_END,
  JULY_LANDING_PAGES,
  JUNE_2026,
  JUNE_CHANNELS,
  JUNE_FOLLOWERS_END,
  JUNE_LANDING_PAGES,
  POSTS,
  SNAPSHOTS,
  type MonthTotals,
} from "./seed/wieler-roofing";

const ROOT = join(__dirname, "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260731);
const jitter = (spread: number) => 1 - spread + rand() * spread * 2;

function daysInMonth(year: number, month1: number): string[] {
  const out: string[] = [];
  const n = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  for (let d = 1; d <= n; d++) out.push(`${year}-${String(month1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  return out;
}

function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= Date.parse(`${end}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Split an integer total across weights; result sums exactly to total. */
function distribute(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / sumW);
  const floors = raw.map(Math.floor);
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

const noisyWeights = (n: number, spread = 0.35) => Array.from({ length: n }, () => jitter(spread));

// ---------------------------------------------------------------------------
// Build rows
// ---------------------------------------------------------------------------

type Source = "ga4" | "meta_facebook" | "meta_instagram" | "meta_ads";
interface Daily {
  source: Source;
  metric_key: string;
  date: string;
  dimension: string;
  dimension_value: string;
  value: number;
}
const daily: Daily[] = [];
const add = (source: Source, metric_key: string, date: string, value: number, dimension = "", dimension_value = "") =>
  daily.push({ source, metric_key, date, dimension, dimension_value, value });

const SOURCE_OF: Record<string, Source> = {
  fb: "meta_facebook",
  ig: "meta_instagram",
  ga4: "ga4",
};
const sourceFor = (key: string) => SOURCE_OF[key.split("_")[0]];

/** Synthetic month totals, scaled toward June so the series has a shape. */
function syntheticMonth(monthsBeforeJune: number): MonthTotals {
  const f = 1 - monthsBeforeJune * 0.035; // gentle upward trend into June
  const s = (v: number) => Math.max(0, Math.round(v * f * jitter(0.12)));
  const sessions = s(JUNE_2026.ga4_sessions);
  return {
    fb_views: s(JUNE_2026.fb_views),
    fb_interactions: s(JUNE_2026.fb_interactions),
    fb_reactions: s(JUNE_2026.fb_reactions),
    fb_page_visits: s(JUNE_2026.fb_page_visits),
    fb_reels_interactions: s(JUNE_2026.fb_reels_interactions),
    fb_net_new_followers: 0, // set from follower path
    ig_views: s(JUNE_2026.ig_views),
    ig_interactions: s(JUNE_2026.ig_interactions),
    ig_profile_visits: s(JUNE_2026.ig_profile_visits),
    ig_reels_views: s(JUNE_2026.ig_reels_views),
    ig_reels_interactions: s(JUNE_2026.ig_reels_interactions),
    ig_post_views: s(JUNE_2026.ig_post_views),
    ig_net_new_followers: 0,
    ga4_sessions: sessions,
    ga4_engaged_sessions: Math.round(sessions * (0.56 + rand() * 0.08)),
    ga4_key_events: s(JUNE_2026.ga4_key_events),
    ga4_page_views: s(JUNE_2026.ga4_page_views),
  };
}

// Follower path, end of month. Aug 2025..May 2026 SYNTHETIC, Jun/Jul from the report.
const months: { year: number; month: number; totals: MonthTotals; fbEnd: number; igEnd: number }[] = [];
let fbEnd = 38;
let igEnd = 158;
const fbStart = fbEnd;
const igStart = igEnd;
for (let i = 0; i < 10; i++) {
  const year = i < 5 ? 2025 : 2026;
  const month = ((7 + i) % 12) + 1; // Aug 2025 .. May 2026
  const totals = syntheticMonth(10 - i);
  const fbTarget = Math.round(fbStart + ((JUNE_FOLLOWERS_END.fb - 1 - fbStart) * (i + 1)) / 10);
  const igTarget = Math.round(igStart + ((JUNE_FOLLOWERS_END.ig - 5 - igStart) * (i + 1)) / 10);
  totals.fb_net_new_followers = fbTarget - fbEnd;
  totals.ig_net_new_followers = igTarget - igEnd;
  fbEnd = fbTarget;
  igEnd = igTarget;
  months.push({ year, month, totals, fbEnd, igEnd });
}
months.push({ year: 2026, month: 6, totals: JUNE_2026, fbEnd: JUNE_FOLLOWERS_END.fb, igEnd: JUNE_FOLLOWERS_END.ig });
months.push({ year: 2026, month: 7, totals: JULY_2026, fbEnd: JULY_FOLLOWERS_END.fb, igEnd: JULY_FOLLOWERS_END.ig });

// Sanity: the report's follower figures must tie out.
const june = months.find((m) => m.month === 6 && m.year === 2026)!;
const may = months[months.indexOf(june) - 1];
if (may.fbEnd + JUNE_2026.fb_net_new_followers !== JUNE_FOLLOWERS_END.fb) throw new Error("FB follower path broken");
if (may.igEnd + JUNE_2026.ig_net_new_followers !== JUNE_FOLLOWERS_END.ig) throw new Error("IG follower path broken");
if (JUNE_FOLLOWERS_END.fb + JULY_2026.fb_net_new_followers !== JULY_FOLLOWERS_END.fb) throw new Error("FB July broken");
if (JUNE_FOLLOWERS_END.ig + JULY_2026.ig_net_new_followers !== JULY_FOLLOWERS_END.ig) throw new Error("IG July broken");

const ADS_START_DAY = 14;

for (const m of months) {
  const days = daysInMonth(m.year, m.month);
  const isJuly = m.year === 2026 && m.month === 7;
  // Facebook in July was quiet until the campaign launched on the 14th.
  const fbWeights = days.map((_, i) => (isJuly ? (i + 1 < ADS_START_DAY ? 0.04 : 1) : 1) * jitter(0.35));
  const flatWeights = noisyWeights(days.length);

  const ga4Specified = m.year === 2026 && (m.month === 6 || m.month === 7);
  for (const [key, total] of Object.entries(m.totals) as [keyof MonthTotals, number][]) {
    if (key.startsWith("ga4_") && ga4Specified) continue; // built from breakdowns below
    const weights = key.startsWith("fb_") ? fbWeights : flatWeights;
    distribute(total, weights).forEach((v, i) => add(sourceFor(key), key, days[i], v));
  }

  // Followers: running total from the previous month end.
  const fbPrev = m.fbEnd - m.totals.fb_net_new_followers;
  const igPrev = m.igEnd - m.totals.ig_net_new_followers;
  const fbNet = daily.filter((r) => r.metric_key === "fb_net_new_followers" && days.includes(r.date));
  const igNet = daily.filter((r) => r.metric_key === "ig_net_new_followers" && days.includes(r.date));
  let fbRun = fbPrev;
  let igRun = igPrev;
  days.forEach((d, i) => {
    fbRun += fbNet[i].value;
    igRun += igNet[i].value;
    add("meta_facebook", "fb_followers", d, fbRun);
    add("meta_instagram", "ig_followers", d, igRun);
  });

  // GA4 breakdowns for June and July; daily totals are the sum of channels.
  if (ga4Specified) {
    const channels = isJuly ? JULY_CHANNELS : JUNE_CHANNELS;
    const pages = isJuly ? JULY_LANDING_PAGES : JUNE_LANDING_PAGES;
    const totals = { sessions: new Array(days.length).fill(0), engaged: new Array(days.length).fill(0), key_events: new Array(days.length).fill(0) };
    for (const c of channels) {
      const paidSocialInJuly = isJuly && c.channel === "Paid Social";
      const w = days.map((_, i) => (paidSocialInJuly && i + 1 < ADS_START_DAY ? 0 : jitter(0.35)));
      const sessions = distribute(c.sessions, w);
      // Engaged and key events follow sessions so engaged <= sessions each day.
      const engaged = distribute(c.engaged, sessions.map((s) => s || 0));
      const keyEvents = distribute(c.key_events, sessions.map((s) => s || 0));
      days.forEach((d, i) => {
        if (sessions[i] === 0 && engaged[i] === 0 && keyEvents[i] === 0) return;
        add("ga4", "ga4_sessions", d, sessions[i], "channel", c.channel);
        add("ga4", "ga4_engaged_sessions", d, engaged[i], "channel", c.channel);
        add("ga4", "ga4_key_events", d, keyEvents[i], "channel", c.channel);
        totals.sessions[i] += sessions[i];
        totals.engaged[i] += engaged[i];
        totals.key_events[i] += keyEvents[i];
      });
    }
    const pageViewTotals = new Array(days.length).fill(0);
    for (const p of pages) {
      const sessions = distribute(p.sessions, noisyWeights(days.length));
      const engaged = distribute(p.engaged, sessions);
      const views = distribute(p.views, sessions);
      const keyEvents = distribute(p.key_events, sessions);
      days.forEach((d, i) => {
        if (sessions[i] === 0) return;
        add("ga4", "ga4_sessions", d, sessions[i], "landing_page", p.page);
        add("ga4", "ga4_engaged_sessions", d, engaged[i], "landing_page", p.page);
        add("ga4", "ga4_page_views", d, views[i], "landing_page", p.page);
        add("ga4", "ga4_key_events", d, keyEvents[i], "landing_page", p.page);
        pageViewTotals[i] += views[i];
      });
    }
    days.forEach((d, i) => {
      add("ga4", "ga4_sessions", d, totals.sessions[i]);
      add("ga4", "ga4_engaged_sessions", d, totals.engaged[i]);
      add("ga4", "ga4_key_events", d, totals.key_events[i]);
      add("ga4", "ga4_page_views", d, pageViewTotals[i]);
    });
  }
}

// Meta Ads daily delivery.
const adDays = dateRange(AD_CAMPAIGN.start_date, AD_CAMPAIGN.end_date);
const adWeights = noisyWeights(adDays.length, 0.25);
const t = AD_CAMPAIGN.totals;
const spendCents = distribute(Math.round(t.spend * 100), adWeights);
const impressions = distribute(t.impressions, adWeights);
const clicks = distribute(t.clicks, impressions);
const leads = distribute(t.leads, noisyWeights(adDays.length, 0.6));
const adDaily = adDays.map((date, i) => ({
  date,
  spend: spendCents[i] / 100,
  impressions: impressions[i],
  reach: Math.round(impressions[i] / 1.32), // daily unique reach, not additive
  clicks: clicks[i],
  leads: leads[i],
}));

const period = [
  {
    source: "meta_ads" as const,
    metric_key: "ads_reach",
    period_start: AD_CAMPAIGN.start_date,
    period_end: AD_CAMPAIGN.end_date,
    value: t.reach,
  },
];

// ---------------------------------------------------------------------------
// Verify ties to the report before writing anything
// ---------------------------------------------------------------------------

const julyDays = new Set(daysInMonth(2026, 7));
const julySum = (key: string) =>
  daily.filter((r) => r.metric_key === key && r.dimension === "" && julyDays.has(r.date)).reduce((s, r) => s + r.value, 0);
for (const [key, expected] of Object.entries(JULY_2026)) {
  if (julySum(key) !== expected) throw new Error(`${key}: ${julySum(key)} != ${expected}`);
}
const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
if (Math.round(sumBy(adDaily, (d) => d.spend) * 100) !== Math.round(t.spend * 100)) throw new Error("spend mismatch");
if (sumBy(adDaily, (d) => d.leads) !== t.leads) throw new Error("leads mismatch");

// ---------------------------------------------------------------------------
// Emit SQL
// ---------------------------------------------------------------------------

const q = (v: string | null | undefined) => (v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`);
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

const sql: string[] = [];
sql.push(`-- GENERATED by scripts/generate-seed.ts. Do not edit by hand.
-- Demo client: Wieler Roofing. July 2026 figures come from FFM's July report;
-- Aug 2025 to May 2026 are synthetic so trend charts render. See
-- scripts/seed/wieler-roofing.ts for the provenance of each value.

begin;

delete from public.clients where id = ${q(CLIENT.id)};

insert into public.clients (id, name, slug, enabled_sources, timezone, market)
values (${q(CLIENT.id)}, ${q(CLIENT.name)}, ${q(CLIENT.slug)},
        array[${CLIENT.enabled_sources.map(q).join(", ")}]::public.data_source[],
        ${q(CLIENT.timezone)}, ${q(CLIENT.market)});

insert into public.connections (client_id, source, status)
select ${q(CLIENT.id)}, s, 'manual'
from unnest(array[${CLIENT.enabled_sources.map(q).join(", ")}]::public.data_source[]) as s;
`);

for (const rows of chunk(daily, 1000)) {
  sql.push(
    `insert into public.metrics_daily (client_id, source, metric_key, date, dimension, dimension_value, value) values\n` +
      rows
        .map((r) => `(${q(CLIENT.id)}, ${q(r.source)}, ${q(r.metric_key)}, ${q(r.date)}, ${q(r.dimension)}, ${q(r.dimension_value)}, ${r.value})`)
        .join(",\n") +
      ";\n",
  );
}

sql.push(
  `insert into public.metrics_period (client_id, source, metric_key, period_start, period_end, value) values\n` +
    period.map((p) => `(${q(CLIENT.id)}, ${q(p.source)}, ${q(p.metric_key)}, ${q(p.period_start)}, ${q(p.period_end)}, ${p.value})`).join(",\n") +
    ";\n",
);

sql.push(`insert into public.ad_campaigns (id, client_id, source, external_campaign_id, name, objective, status, start_date, end_date)
values (${q(AD_CAMPAIGN.id)}, ${q(CLIENT.id)}, 'meta_ads', ${q(AD_CAMPAIGN.external_campaign_id)}, ${q(AD_CAMPAIGN.name)},
        ${q(AD_CAMPAIGN.objective)}, ${q(AD_CAMPAIGN.status)}, ${q(AD_CAMPAIGN.start_date)}, ${q(AD_CAMPAIGN.end_date)});
`);
sql.push(
  `insert into public.ad_metrics_daily (client_id, campaign_id, date, spend, impressions, reach, clicks, leads) values\n` +
    adDaily
      .map((d) => `(${q(CLIENT.id)}, ${q(AD_CAMPAIGN.id)}, ${q(d.date)}, ${d.spend.toFixed(2)}, ${d.impressions}, ${d.reach}, ${d.clicks}, ${d.leads})`)
      .join(",\n") +
    ";\n",
);

sql.push(
  `insert into public.posts (client_id, platform, external_id, published_at, format, summary, caption, views) values\n` +
    POSTS.map(
      (p) => `(${q(CLIENT.id)}, ${q(p.platform)}, ${q(p.external_id)}, ${q(p.published_at)}, ${q(p.format)}, ${q(p.summary)}, ${q(p.summary)}, ${p.views})`,
    ).join(",\n") +
    ";\n",
);

const PERIOD_TYPES = new Set(["discovery_surface", "follower_status", "follower_status_engagement", "format_engagement"]);
sql.push(
  `insert into public.audience_snapshots (client_id, platform, snapshot_date, period_start, breakdown_type, bucket, share) values\n` +
    SNAPSHOTS.map(
      (s) =>
        `(${q(CLIENT.id)}, ${q(s.platform)}, '2026-07-31', ${PERIOD_TYPES.has(s.type) ? "'2026-07-01'" : "null"}, ${q(s.type)}, ${q(s.bucket)}, ${s.share})`,
    ).join(",\n") +
    ";\n",
);

const c = JULY_COMMENTARY;
sql.push(`insert into public.monthly_commentary
  (client_id, month, headline, summary, platform_narratives, section_notes, conclusion, status, published_at)
values (${q(CLIENT.id)}, ${q(c.month)}, ${q(c.headline)}, ${q(c.summary)},
        ${q(JSON.stringify(c.platform_narratives))}::jsonb, ${q(JSON.stringify(c.section_notes))}::jsonb,
        ${q(c.conclusion)}, 'published', '2026-08-08T15:00:00Z');
`);

sql.push(
  `insert into public.annotations (client_id, date, label, description) values\n` +
    ANNOTATIONS.map((a) => `(${q(CLIENT.id)}, ${q(a.date)}, ${q(a.label)}, ${q(a.description)})`).join(",\n") +
    ";\n",
);

sql.push("commit;\n");

const seedPath = join(ROOT, "supabase", "seed.sql");
writeFileSync(seedPath, sql.join("\n"));

// ---------------------------------------------------------------------------
// Emit demo fixture (used when Supabase env vars are not set, dev only)
// ---------------------------------------------------------------------------

const fixture = {
  client: { ...CLIENT, logo_url: null, brand_color: null },
  metricsDaily: daily.map(({ source, metric_key, date, dimension, dimension_value, value }) => ({
    source,
    metric_key,
    date,
    dimension,
    dimension_value,
    value,
  })),
  metricsPeriod: period,
  adCampaigns: [{ ...AD_CAMPAIGN, totals: undefined }],
  adMetricsDaily: adDaily.map((d) => ({ ...d, campaign_id: AD_CAMPAIGN.id })),
  posts: POSTS,
  audienceSnapshots: SNAPSHOTS.map((s) => ({
    platform: s.platform,
    breakdown_type: s.type,
    bucket: s.bucket,
    share: s.share,
    snapshot_date: "2026-07-31",
    period_start: PERIOD_TYPES.has(s.type) ? "2026-07-01" : null,
  })),
  commentary: [{ ...c, status: "published" }],
  annotations: ANNOTATIONS,
};
const fixturePath = join(ROOT, "src", "lib", "demo", "fixture.json");
mkdirSync(dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, JSON.stringify(fixture));

console.log(`Wrote ${daily.length} daily rows, ${adDaily.length} ad rows`);
console.log(`  ${seedPath}`);
console.log(`  ${fixturePath}`);
