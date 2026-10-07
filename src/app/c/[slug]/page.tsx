import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { InfoTip, MetricLabel } from "@/components/info-tip";
import { BigDelta, KpiTile } from "@/components/kpi";
import { PdfMenu } from "@/components/pdf-menu";
import { PeriodPicker } from "@/components/period-picker";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { Card, DataTable, Prose, Section, ShareBars } from "@/components/section";
import { TrendCharts } from "@/components/trend-charts";
import { getClientBySlug, getViewer, isFfm } from "@/lib/data/portal";
import { addMonths, daysBetween, formatDay, formatMonth, formatRange, monthsBetween } from "@/lib/dates";
import { METRICS, SOCIAL_OVERVIEW_KEYS } from "@/lib/metrics/config";
import { formatMetric } from "@/lib/metrics/format";
import { GLOSSARY } from "@/lib/metrics/glossary";
import { SOCIAL_SOURCES, SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";
import { ADS_TABLE, FORMAT_LABELS, loadReport, PLATFORM_TILES, snapshotsOf } from "@/lib/report/load";
import { describeRange, periodQuery } from "@/lib/report/period";

export const metadata: Metadata = { title: "Performance Report" };

export default function ClientReportPage(props: PageProps<"/c/[slug]">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ClientReport {...props} />
    </Suspense>
  );
}

async function ClientReport(props: PageProps<"/c/[slug]">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);

  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  // RLS returns nothing for clients the viewer cannot access, so this 404s.
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  // "Today" decides the preset ranges, so the report always renders per request.
  await connection();
  const report = await loadReport(client, search);
  const {
    today,
    thisMonth,
    period,
    range,
    compareRange,
    campaigns,
    adsRange,
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
    nav,
    compareTitle,
    heroTiles,
  } = report;
  const { content: showContent, audience: showAudience, discovery: showDiscovery, video: showVideo } = report.show;

  let n = 0;
  const next = () => ++n;


  const pickerMonths = monthsBetween(addMonths(thisMonth, -35), thisMonth)
    .reverse()
    .map((m) => [m, formatMonth(m)] as [string, string]);

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />

      <main className="mx-auto max-w-6xl space-y-16 px-4 pb-24 pt-8 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Reporting period</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{period.label}</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              {period.label === describeRange(range) ? "" : `${describeRange(range)} · `}
              {period.compareLabel ? `Compared with ${period.compareLabel}` : "No comparison"}
            </p>
          </div>
          <div className="flex items-stretch gap-2">
            <PeriodPicker
              preset={period.preset}
              range={range}
              label={period.label}
              rangeLabel={describeRange(range)}
              compareMode={period.compareMode}
              compareRange={compareRange}
              compareLabel={period.compareLabel}
              months={pickerMonths}
              prevMonth={period.month ? addMonths(period.month, -1) : null}
              nextMonth={period.month && period.month < thisMonth ? addMonths(period.month, 1) : null}
            />
            <PdfMenu
              href={`/c/${client.slug}/pdf?${periodQuery({ preset: period.preset, range, compareMode: period.compareMode, compareRange })}`}
              note={commentary?.status === "draft" ? "Draft commentary is left out of the PDF until it is published." : null}
            />
          </div>
        </div>

        <nav
          aria-label="Report sections"
          className="sticky top-16 z-30 -mx-4 -my-10 border-b border-line bg-page/90 px-4 backdrop-blur sm:mx-0 sm:px-0"
        >
          <ul className="-mb-px flex gap-1 overflow-x-auto py-2 text-sm [scrollbar-width:none]">
            {nav.map((n) => (
              <li key={n.id} className="shrink-0">
                <a href={`#${n.id}`} className="block rounded-md px-3 py-1.5 text-fg-secondary transition hover:bg-raised hover:text-fg">
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {period.notice && (
          <p className="rounded-lg border border-line bg-raised p-3 text-sm text-fg-secondary" role="status">
            {period.notice}
          </p>
        )}

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
              {commentary?.headline ?? `${client.name} performance for ${describeRange(range)}`}
            </h3>
            <div className="relative mt-6 max-w-3xl text-sm leading-relaxed text-teal-100 sm:text-base">
              {commentary?.summary ? (
                <Prose text={commentary.summary} />
              ) : period.month ? (
                <p>Flow Forward Media&apos;s summary for this month is on its way.</p>
              ) : (
                <p>Flow Forward Media writes a summary for each calendar month. Choose a single month to read it.</p>
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
        {showContent && (
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
        {showAudience && (
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
        {showDiscovery && (
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
        {showVideo && (
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
              <KpiTile
                metricKey="ads_leads"
                label="Leads Generated"
                value={val("ads_leads", adsRange)}
                comparison={adsCmp("ads_leads")}
                caption={formatRange(adsRange)}
              />
              <KpiTile
                metricKey="ads_reach"
                label="Total Reach"
                value={val("ads_reach", adsRange)}
                estimated={resolver.resolve("ads_reach", adsRange).estimated}
                comparison={adsCmp("ads_reach")}
                caption="Different people reached"
              />
              <KpiTile
                metricKey="ads_spend"
                value={val("ads_spend", adsRange)}
                comparison={adsCmp("ads_spend")}
                caption={`${daysBetween(adsRange)} days of activity`}
              />
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
          <Section id="mom" number={next()} title={compareTitle} intro={`${period.label} compared with ${period.compareLabel}.`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {momKeys.map((k) => {
                const c = mom(k)!;
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

        {/* Trends */}
        {trends.length > 0 && (
          <Section
            id="trends"
            number={next()}
            title="Monthly Trends"
            intro={`Month by month, ${formatMonth(months[0])} to ${formatMonth(months.at(-1)!)}. Hover or tap a chart for exact numbers.`}
          >
            <TrendCharts series={trends} annotations={chartAnnotations} groups={trendGroups} />
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
