import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { InfoTip, MetricLabel } from "@/components/info-tip";
import { BigDelta, KpiTile } from "@/components/kpi";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { Card, DataTable, Prose, Section, ShareBars } from "@/components/section";
import {
  getAdCampaigns,
  getAnnotations,
  getAudienceSnapshots,
  getClientBySlug,
  getCommentary,
  getLatestDataDate,
  getLatestPublishedMonth,
  getMetricData,
  getTopPosts,
  getViewer,
  isFfm,
  type AudienceSnapshot,
} from "@/lib/data/portal";
import { addMonths, daysBetween, formatDay, formatMonth, formatRange, isValidMonthParam, monthOf, monthRange } from "@/lib/dates";
import { compare, MetricResolver, onlyEnabledSources, type DateRange } from "@/lib/metrics/aggregate";
import { METRICS, SOCIAL_OVERVIEW_KEYS } from "@/lib/metrics/config";
import { formatMetric } from "@/lib/metrics/format";
import { GLOSSARY } from "@/lib/metrics/glossary";
import { SOCIAL_SOURCES, SOURCE_LABELS, type DataSource, type SocialSource } from "@/lib/metrics/types";

export const metadata: Metadata = { title: "Performance Report" };

export default function ClientReportPage(props: PageProps<"/c/[slug]">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ClientReport {...props} />
    </Suspense>
  );
}

/** Three headline tiles per platform, as in the monthly report. */
const PLATFORM_TILES: Record<SocialSource, { keys: [string, string, string]; headline: [string, string] }> = {
  meta_facebook: { keys: ["fb_followers", "fb_reactions", "fb_page_visits"], headline: ["fb_views", "fb_interactions"] },
  meta_instagram: { keys: ["ig_followers", "ig_reels_views", "ig_profile_visits"], headline: ["ig_views", "ig_interactions"] },
  tiktok: { keys: ["tt_followers", "tt_views", "tt_profile_views"], headline: ["tt_views", "tt_interactions"] },
  linkedin: { keys: ["li_followers", "li_impressions", "li_page_views"], headline: ["li_impressions", "li_interactions"] },
};

/** Candidates for the month-over-month grid; only ones with data are shown. */
const MOM_KEYS = [
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

const ADS_TABLE: { key: string; meaning: string }[] = [
  { key: "ads_leads", meaning: "People who completed the lead form after seeing the ad" },
  { key: "ads_spend", meaning: "Total ad spend across the campaign period" },
  { key: "ads_reach", meaning: "Number of different people who saw the ads at least once" },
  { key: "ads_frequency", meaning: "Average number of times each person saw the ads" },
  { key: "ads_ctr", meaning: "Share of people who clicked the ad after seeing it" },
  { key: "ads_cpl", meaning: "Average cost for each lead the campaign generated" },
];

const FORMAT_LABELS: Record<string, string> = {
  reel: "Reel",
  photo: "Photo Post",
  carousel: "Carousel",
  link: "Link Post",
  video: "Video",
  story: "Story",
  text: "Text Post",
  other: "Other",
};

function snapshotsOf(snaps: AudienceSnapshot[], platform: DataSource, type: string) {
  return snaps.filter((s) => s.platform === platform && s.breakdown_type === type);
}

async function ClientReport(props: PageProps<"/c/[slug]">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);

  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  // RLS returns nothing for clients the viewer cannot access, so this 404s.
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  // Default landing: the latest month with published commentary, else the
  // latest month with data.
  let month: string;
  if (isValidMonthParam(search.month)) {
    month = `${search.month}-01`;
  } else {
    const published = await getLatestPublishedMonth(client.id);
    const latestData = await getLatestDataDate(client.id);
    month = published ?? (latestData ? monthOf(latestData) : monthOf(new Date().toISOString().slice(0, 10)));
  }
  const range = monthRange(month);
  const prevRange = monthRange(addMonths(month, -1));
  const enabled = new Set(client.enabled_sources);

  // The ads section follows the PDF report: it covers the full window of every
  // campaign that ran during the month, even if it extends past month end.
  const campaigns = enabled.has("meta_ads") ? await getAdCampaigns(client.id, range) : [];
  const adsRange: DateRange | null = campaigns.length
    ? {
        start: campaigns.map((c) => c.start_date ?? range.start).sort()[0],
        end: campaigns.map((c) => c.end_date ?? range.end).sort().at(-1)!,
      }
    : null;

  const fetchRange: DateRange = {
    start: [prevRange.start, adsRange?.start ?? prevRange.start].sort()[0],
    end: [range.end, adsRange?.end ?? range.end].sort().at(-1)!,
  };

  const [allData, commentary, allPosts, allSnapshots, annotations] = await Promise.all([
    getMetricData(client.id, fetchRange),
    getCommentary(client.id, month),
    getTopPosts(client.id, range, 8),
    getAudienceSnapshots(client.id, range),
    getAnnotations(client.id, range),
  ]);

  // Only the client's turned-on channels appear anywhere in the report,
  // including combined totals, even if older data exists for others.
  const data = onlyEnabledSources(allData, enabled);
  const posts = allPosts.filter((p) => enabled.has(p.platform));
  const snapshots = allSnapshots.filter((s) => enabled.has(s.platform));

  const resolver = new MetricResolver(data);
  const val = (key: string, r: DateRange = range) => resolver.resolve(key, r).value;
  const mom = (key: string) => compare(key, val(key), val(key, prevRange));

  const socials = SOCIAL_SOURCES.filter((s) => enabled.has(s) && val(SOCIAL_OVERVIEW_KEYS[s].views) !== null);
  const narratives = commentary?.platform_narratives ?? {};
  const notes = commentary?.section_notes ?? {};
  const hasWebsite = enabled.has("ga4") && val("ga4_sessions") !== null;
  const hasAds = adsRange !== null && val("ads_spend", adsRange) !== null;
  const momKeys = MOM_KEYS.filter((k) => val(k) !== null && val(k, prevRange) !== null);

  let n = 0;
  const next = () => ++n;

  const heroTiles = [
    { key: "total_audience_reach", caption: socials.map((s) => `${SOURCE_LABELS[s]} ${METRICS[SOCIAL_OVERVIEW_KEYS[s].views].label}`).join(" + ") },
    { key: "total_interactions", caption: socials.map((s) => SOURCE_LABELS[s]).join(" + ") + " engagement" },
    ...(hasWebsite ? [{ key: "ga4_engagement_rate", caption: "Website visits that engaged", label: "Website Engagement" }] : []),
  ] as { key: string; caption: string; label?: string }[];

  const monthLinks = { prev: addMonths(month, -1).slice(0, 7), next: addMonths(month, 1).slice(0, 7) };

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />

      <main className="mx-auto max-w-6xl space-y-16 px-4 pb-24 pt-8 sm:px-6">
        {/* Period bar. Full date range picker and comparison modes arrive in Phase 3. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Reporting period</p>
            <p className="mt-1 text-lg font-semibold">
              {formatMonth(month)} <span className="font-normal text-fg-secondary">· compared with {formatMonth(prevRange.start)}</span>
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Link href={`?month=${monthLinks.prev}`} className="rounded-lg border border-line bg-surface px-3 py-2 text-fg-secondary transition hover:border-line-focus hover:text-fg">
              ← {formatMonth(monthLinks.prev)}
            </Link>
            <Link href={`?month=${monthLinks.next}`} className="rounded-lg border border-line bg-surface px-3 py-2 text-fg-secondary transition hover:border-line-focus hover:text-fg">
              {formatMonth(monthLinks.next)} →
            </Link>
          </div>
        </div>

        {commentary?.status === "draft" && isFfm(viewer.role) && (
          <p className="rounded-lg border border-line-focus bg-teal-950 p-3 text-sm text-teal-100">
            This month&apos;s commentary is a draft. Clients will not see it until it is published.
          </p>
        )}

        {/* 1. Executive summary */}
        <Section id="summary" number={next()} title="Executive Summary">
          <div className="relative overflow-hidden rounded-2xl border border-line-focus bg-gradient-to-br from-teal-900 via-teal-950 to-page p-6 sm:p-10">
            <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-teal/10 blur-3xl" />
            <h3 className="relative text-2xl font-semibold leading-tight tracking-tight sm:text-4xl">
              {commentary?.headline ?? `${client.name} performance for ${formatMonth(month)}`}
            </h3>
            <div className="relative mt-6 max-w-3xl text-sm leading-relaxed text-teal-100 sm:text-base">
              {commentary?.summary ? (
                <Prose text={commentary.summary} />
              ) : (
                <p>Flow Forward Media&apos;s summary for this month is on its way.</p>
              )}
            </div>
          </div>
          <div className={`mt-6 grid grid-cols-1 gap-4 ${heroTiles.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
            {heroTiles.map((t) => (
              <KpiTile key={t.key} size="lg" metricKey={t.key} label={t.label} value={val(t.key)} comparison={mom(t.key)} caption={t.caption} />
            ))}
          </div>
          {annotations.length > 0 && (
            <ul className="mt-6 space-y-2">
              {annotations.map((a) => (
                <li key={a.date + a.label} className="flex gap-3 text-sm">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-teal" aria-hidden />
                  <span>
                    <span className="font-medium text-fg">{formatDay(a.date)}:</span>{" "}
                    <span className="text-fg-secondary">{a.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 2. Key terms */}
        <Section id="terms" number={next()} title="Understanding Key Social Media Terms">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GLOSSARY.map((g) => (
              <Card key={g.id} className="p-4">
                <p className="font-semibold text-teal">{g.term}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-secondary">{g.definition}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* 3. Social overview */}
        {socials.length > 0 && (
          <Section id="social" number={next()} title="Social Media Performance Overview">
            <DataTable
              caption="Social media performance by platform"
              columns={[
                { label: "Platform" },
                { label: <MetricLabel metricKey="total_followers" label="Ending Audience" />, align: "right" },
                { label: <MetricLabel metricKey="total_net_new_followers" label="Net New Followers" />, align: "right" },
                { label: <MetricLabel metricKey="total_audience_reach" label="Total Views / Reach" />, align: "right" },
                { label: <MetricLabel metricKey="total_interactions" label="Total Interactions" />, align: "right" },
              ]}
              rows={socials.map((s) => {
                const k = SOCIAL_OVERVIEW_KEYS[s];
                const net = val(k.netNew);
                return [
                  SOURCE_LABELS[s],
                  formatMetric(k.followers, val(k.followers)),
                  net === null ? "N/A" : `${net > 0 ? "+" : ""}${formatMetric(k.netNew, net)}`,
                  formatMetric(k.views, val(k.views)),
                  formatMetric(k.interactions, val(k.interactions)),
                ];
              })}
              footer={[
                "Total Combined",
                formatMetric("total_followers", val("total_followers")),
                `+${formatMetric("total_net_new_followers", val("total_net_new_followers"))}`,
                formatMetric("total_audience_reach", val("total_audience_reach")),
                formatMetric("total_interactions", val("total_interactions")),
              ]}
            />
          </Section>
        )}

        {/* 4. Platform breakdown */}
        {socials.length > 0 && (
          <Section id="platforms" number={next()} title="Platform Performance Breakdown">
            <div className="space-y-10">
              {socials.map((s, i) => {
                const cfg = PLATFORM_TILES[s];
                const narrative = narratives[s];
                const [viewsKey, intKey] = cfg.headline;
                return (
                  <div key={s}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-teal">
                      {i + 1} · {SOURCE_LABELS[s]}
                    </p>
                    <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                      {narrative?.headline ??
                        `${formatMetric(viewsKey, val(viewsKey))} ${METRICS[viewsKey].label}, ${formatMetric(intKey, val(intKey))} ${METRICS[intKey].label}`}
                    </h3>
                    {narrative?.body && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-secondary sm:text-base">{narrative.body}</p>}
                    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {cfg.keys.map((k) => (
                        <KpiTile key={k} metricKey={k} value={val(k)} comparison={mom(k)} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Website */}
        {hasWebsite && (
          <Section id="website" number={next()} title="Website Performance" intro={narratives.ga4?.body}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {["ga4_sessions", "ga4_engagement_rate", "ga4_key_events"].map((k) => (
                <KpiTile key={k} metricKey={k} value={val(k)} comparison={mom(k)} />
              ))}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-secondary">Sessions by channel</h3>
                <DataTable
                  caption="Website sessions by channel"
                  columns={[
                    { label: "Channel" },
                    { label: <MetricLabel metricKey="ga4_sessions" />, align: "right" },
                    { label: <MetricLabel metricKey="ga4_engagement_rate" label="Engagement" />, align: "right" },
                    { label: <MetricLabel metricKey="ga4_key_events" />, align: "right" },
                  ]}
                  rows={resolver.breakdown("ga4_sessions", "channel", range).map(({ bucket, value }) => {
                    const f = { dimension: "channel", value: bucket };
                    return [
                      bucket,
                      formatMetric("ga4_sessions", value),
                      formatMetric("ga4_engagement_rate", resolver.resolve("ga4_engagement_rate", range, f).value),
                      formatMetric("ga4_key_events", resolver.resolve("ga4_key_events", range, f).value),
                    ];
                  })}
                />
              </div>
              <div>
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-fg-secondary">Top landing pages</h3>
                <DataTable
                  caption="Top landing pages"
                  columns={[
                    { label: "Page" },
                    { label: <MetricLabel metricKey="ga4_page_views" label="Views" />, align: "right" },
                    { label: <MetricLabel metricKey="ga4_key_events" />, align: "right" },
                  ]}
                  rows={resolver
                    .breakdown("ga4_page_views", "landing_page", range)
                    .slice(0, 8)
                    .map(({ bucket, value }) => [
                      <span key={bucket} className="font-mono text-xs sm:text-sm">{bucket}</span>,
                      formatMetric("ga4_page_views", value),
                      formatMetric("ga4_key_events", resolver.resolve("ga4_key_events", range, { dimension: "landing_page", value: bucket }).value),
                    ])}
                />
              </div>
            </div>
          </Section>
        )}

        {/* 5. Content */}
        {(posts.length > 0 || snapshotsOf(snapshots, "meta_facebook", "format_engagement").length > 0) && (
          <Section id="content" number={next()} title="Content and Engagement Analysis" intro={notes.content}>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
              {posts.length > 0 && (
                <DataTable
                  caption="Top posts by views"
                  columns={[{ label: "Platform" }, { label: "Format" }, { label: "Post" }, { label: "Views", align: "right" }]}
                  rows={posts.map((p) => [
                    SOURCE_LABELS[p.platform],
                    FORMAT_LABELS[p.format] ?? p.format,
                    p.permalink ? (
                      <a key={p.external_id} href={p.permalink} target="_blank" rel="noreferrer" className="text-fg hover:text-teal">
                        {p.summary}
                      </a>
                    ) : (
                      <span key={p.external_id} className="text-fg">{p.summary}</span>
                    ),
                    formatMetric("ig_views", p.views),
                  ])}
                />
              )}
              {SOCIAL_SOURCES.filter((s) => snapshotsOf(snapshots, s, "format_engagement").length > 0).map((s) => (
                <Card key={s} className="p-5">
                  <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-secondary">
                    {SOURCE_LABELS[s]} engagement by format
                  </h3>
                  <ShareBars items={snapshotsOf(snapshots, s, "format_engagement")} />
                </Card>
              ))}
            </div>
          </Section>
        )}

        {/* 6. Demographics */}
        {snapshots.some((s) => ["age", "gender", "country", "language"].includes(s.breakdown_type)) && (
          <Section id="audience" number={next()} title="Audience Growth and Demographics" intro={notes.demographics}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOCIAL_SOURCES.flatMap((s) =>
                (["age", "gender", "country", "language"] as const)
                  .filter((t) => snapshotsOf(snapshots, s, t).length > 0)
                  .map((t) => (
                    <Card key={`${s}-${t}`} className="p-5">
                      <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-fg-secondary">
                        {SOURCE_LABELS[s]} audience by {t === "age" ? "age range" : t === "country" ? "top countries" : t === "language" ? "top languages" : t}
                      </h3>
                      <ShareBars
                        items={snapshotsOf(snapshots, s, t).sort((a, b) => (t === "age" ? a.bucket.localeCompare(b.bucket) : b.share - a.share))}
                      />
                    </Card>
                  )),
              )}
            </div>
          </Section>
        )}

        {/* 7. Discovery */}
        {snapshots.some((s) => ["discovery_surface", "follower_status"].includes(s.breakdown_type)) && (
          <Section id="discovery" number={next()} title="Visibility, Discovery, and Profile Activity" intro={notes.discovery}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {SOCIAL_SOURCES.flatMap((s) =>
                (["discovery_surface", "follower_status"] as const)
                  .filter((t) => snapshotsOf(snapshots, s, t).length > 0)
                  .map((t) => (
                    <Card key={`${s}-${t}`} className="p-5">
                      <h3 className="mb-4 flex items-center text-sm font-medium uppercase tracking-wider text-fg-secondary">
                        {SOURCE_LABELS[s]} {t === "discovery_surface" ? "views by where people found you" : "views from followers vs non-followers"}
                        {t === "follower_status" && (
                          <InfoTip label="Non-followers" text="People who saw your content without following you. A high share means your content is reaching new people." />
                        )}
                      </h3>
                      <ShareBars items={snapshotsOf(snapshots, s, t)} />
                    </Card>
                  )),
              )}
            </div>
          </Section>
        )}

        {/* 8. Video */}
        {(val("ig_reels_views") !== null || val("fb_reels_interactions") !== null) && (
          <Section id="video" number={next()} title="Video and Short-Form Content Performance" intro={notes.video}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {["ig_reels_views", "fb_reels_engagement_share", "ig_reels_interactions"]
                .filter((k) => val(k) !== null)
                .map((k) => (
                  <KpiTile key={k} metricKey={k} value={val(k)} comparison={mom(k)} label={`${METRICS[k].source === "meta_instagram" ? "IG" : "FB"} ${METRICS[k].label}`} />
                ))}
            </div>
          </Section>
        )}

        {/* 9. Meta ads */}
        {hasAds && adsRange && (
          <Section id="ads" number={next()} title="Meta Ad Performance">
            <div className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-teal-950 to-surface p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-widest text-teal">
                Meta Ads · {formatRange(adsRange)}
              </p>
              <h3 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
                {narratives.meta_ads?.headline ?? `${formatMetric("ads_leads", val("ads_leads", adsRange))} Leads Generated`}
              </h3>
              {narratives.meta_ads?.body && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-secondary sm:text-base">{narratives.meta_ads.body}</p>}
              {campaigns.length > 0 && (
                <p className="mt-3 text-xs text-fg-muted">
                  {campaigns.length === 1 ? "Campaign" : "Campaigns"}: {campaigns.map((c) => c.name).join(", ")}
                </p>
              )}
            </div>
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <KpiTile metricKey="ads_leads" label="Leads Generated" value={val("ads_leads", adsRange)} caption={formatRange(adsRange)} />
              <KpiTile
                metricKey="ads_reach"
                label="Total Reach"
                value={val("ads_reach", adsRange)}
                estimated={resolver.resolve("ads_reach", adsRange).estimated}
                caption="Different people reached"
              />
              <KpiTile metricKey="ads_spend" value={val("ads_spend", adsRange)} caption={`${daysBetween(adsRange)} days of activity`} />
            </div>
            <div className="mt-6">
              <DataTable
                caption="Meta ad metrics explained"
                columns={[{ label: "Metric" }, { label: "Value", align: "right" }, { label: "What it means" }]}
                rows={ADS_TABLE.map(({ key, meaning }) => [
                  <MetricLabel key={key} metricKey={key} />,
                  <span key={`${key}-v`} className="font-semibold text-teal">{formatMetric(key, val(key, adsRange))}</span>,
                  meaning,
                ])}
              />
            </div>
          </Section>
        )}

        {/* 10. Month over month */}
        {momKeys.length > 0 && (
          <Section id="mom" number={next()} title="Month-over-Month Comparison">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {momKeys.map((k) => {
                const c = mom(k);
                const def = METRICS[k];
                const prefix = def.source === "combined" ? "" : `${SOURCE_LABELS[def.source as DataSource]} `;
                return (
                  <Card key={k} className="relative overflow-hidden p-5">
                    <div
                      aria-hidden
                      className={`absolute inset-x-0 top-0 h-1 ${
                        c.sentiment === "positive" ? "bg-positive" : c.sentiment === "negative" ? "bg-negative" : "bg-line"
                      }`}
                    />
                    <MetricLabel metricKey={k} label={`${prefix}${def.label}`} className="block text-xs font-medium uppercase tracking-wider text-fg-secondary" />
                    <div className="mt-3">
                      <BigDelta comparison={c} />
                    </div>
                    <p className="mt-3 text-sm tabular-nums text-fg-secondary">
                      {formatMetric(k, c.previous)} <span className="text-fg-muted">→</span>{" "}
                      <span className="font-semibold text-fg">{formatMetric(k, c.current)}</span>
                    </p>
                  </Card>
                );
              })}
            </div>
          </Section>
        )}

        {/* 11. Conclusion */}
        {commentary?.conclusion && (
          <Section id="conclusion" number={next()} title="Conclusion">
            <Card className="p-6 text-sm leading-relaxed text-fg-secondary sm:p-8 sm:text-base">
              <Prose text={commentary.conclusion} />
            </Card>
          </Section>
        )}

        <footer className="border-t border-line pt-6 text-center text-xs text-fg-muted">
          Produced by Flow Forward Media
        </footer>
      </main>
    </>
  );
}
