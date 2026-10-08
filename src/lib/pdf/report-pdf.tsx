import "server-only";
import path from "node:path";
import { Document, Font, Image, Line, Page, Polyline, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/stylesheet";
import { daysBetween, formatDay, formatMonth, formatRange } from "@/lib/dates";
import type { Comparison } from "@/lib/metrics/aggregate";
import { METRICS, SOCIAL_OVERVIEW_KEYS } from "@/lib/metrics/config";
import { formatDelta, formatMetric, formatPctChange, formatValue } from "@/lib/metrics/format";
import { GLOSSARY } from "@/lib/metrics/glossary";
import { SOCIAL_SOURCES, SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";
import { ADS_TABLE, AUCTION_KEYS, AUCTION_LABELS, DEMOGRAPHICS, GOOGLE_ADS_TABLE, FORMAT_LABELS, snapshotsOf, VIDEO_KEYS, videoLabel, WEBSITE_COLUMNS, type Report } from "@/lib/report/load";
import { PLATFORM_COLORS, type Bar, type CompetitorTable } from "@/lib/report/social";
import { describeRange } from "@/lib/report/period";
import type { TrendSeries } from "@/lib/report/trends";
import { DARK, PRINT, type PdfTheme } from "./theme";

/*
 * The report as an A4 PDF, built from the same data as the web page. Laid out
 * like the monthly PDF FFM sends: logo top left and a footer on every page,
 * numbered sections with a teal rule, KPI cards with a teal top border.
 */

const ASSETS = path.join(process.cwd(), "src/lib/pdf/assets");
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({
    family: "Inter",
    fonts: [400, 500, 600, 700].map((w) => ({ src: path.join(ASSETS, `inter-latin-${w}-normal.woff`), fontWeight: w })),
  });
  // Never split words across lines.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}

export type PdfThemeName = "dark" | "print";

export async function renderReportPdf(report: Report, theme: PdfThemeName): Promise<Buffer> {
  registerFonts();
  return renderToBuffer(<ReportPdf report={report} t={theme === "print" ? PRINT : DARK} />);
}

export function pdfFileName(report: Report): string {
  const name = report.client.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  const when = describeRange(report.range).replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  return `${name}-${when}.pdf`;
}

// ---------------------------------------------------------------------------

function styles(t: PdfTheme) {
  return StyleSheet.create({
    page: { backgroundColor: t.page, color: t.fg, fontFamily: "Inter", fontSize: 9, paddingTop: 78, paddingBottom: 52, paddingHorizontal: 40, lineHeight: 1.45 },
    header: { position: "absolute", top: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
    headerRule: { position: "absolute", top: 62, left: 40, right: 40, height: 1.5, backgroundColor: t.accent },
    footer: { position: "absolute", bottom: 22, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: t.fgMuted },
    eyebrow: { fontSize: 7, fontWeight: 600, letterSpacing: 1.2, textTransform: "uppercase", color: t.accentText },
    label: { fontSize: 7, fontWeight: 500, letterSpacing: 0.8, textTransform: "uppercase", color: t.fgSecondary },
    h1: { fontSize: 22, fontWeight: 600, marginTop: 4, lineHeight: 1.2 },
    h2: { fontSize: 14, fontWeight: 600, borderLeftWidth: 3, borderLeftColor: t.accent, paddingLeft: 9, marginBottom: 10 },
    h3: { fontSize: 11.5, fontWeight: 600, marginTop: 3 },
    body: { color: t.fgSecondary, fontSize: 9, lineHeight: 1.55 },
    section: { marginTop: 22 },
    card: { backgroundColor: t.surface, borderWidth: 0.75, borderColor: t.line, borderRadius: 6, padding: 10 },
    row: { flexDirection: "row", gap: 8 },
  });
}
type S = ReturnType<typeof styles>;

function ReportPdf({ report, t }: { report: Report; t: PdfTheme }) {
  const s = styles(t);
  const r = report;
  const { period, range, val, mom, socials, social, narratives, notes, commentary } = r;
  let n = 0;
  const next = () => ++n;
  const year = r.today.slice(0, 4);

  return (
    <Document title={`${r.client.name} Performance Report, ${period.label}`} author="Flow Forward Media" creator="Flow Forward Media" producer="Flow Forward Media">
      <Page size="A4" style={s.page}>
        {/* Header and footer on every page */}
        <View fixed style={s.header}>
          <Image src={path.join(ASSETS, t.logo)} style={{ height: 26, width: 56 }} />
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 10, fontWeight: 600 }}>{r.client.name}</Text>
            <Text style={{ fontSize: 7.5, color: t.fgSecondary }}>Performance Report · {period.label}</Text>
            <Text style={{ fontSize: 7, color: t.fgMuted }}>Prepared by Flow Forward Media</Text>
          </View>
        </View>
        <View fixed style={s.headerRule} />
        <View fixed style={s.footer}>
          <Text>
            © {year} Flow Forward Media | Produced for {r.client.name} | Confidential
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>

        {/* Title */}
        <View>
          <Text style={s.eyebrow}>Performance Report</Text>
          <Text style={s.h1}>{period.label}</Text>
          <Text style={[s.body, { marginTop: 2 }]}>
            {period.label === describeRange(range) ? "" : `${describeRange(range)} · `}
            {period.compareLabel ? `Compared with ${period.compareLabel}` : "No comparison"}
          </Text>
        </View>

        {/* Executive summary */}
        <View style={s.section}>
          <Heading s={s} n={next()} title="Executive Summary" />
          <View wrap={false} style={{ backgroundColor: t.heroBg, borderRadius: 8, padding: 16, borderLeftWidth: 3, borderLeftColor: t.accent }}>
            <Text style={{ fontSize: 15, fontWeight: 600, color: t.name === "dark" ? "#ffffff" : t.fg, lineHeight: 1.25 }}>
              {commentary?.headline ?? `${r.client.name} performance for ${describeRange(range)}`}
            </Text>
            {commentary?.summary ? (
              <Paragraphs text={commentary.summary} style={{ marginTop: 8, color: t.heroText, fontSize: 9.5, lineHeight: 1.55 }} />
            ) : (
              <Text style={{ marginTop: 8, color: t.heroText }}>
                {period.month ? "Flow Forward Media's summary for this month is on its way." : "Commentary is written for each calendar month."}
              </Text>
            )}
          </View>
          <View style={[s.row, { marginTop: 10 }]}>
            {r.heroTiles.map((tile) => (
              <Kpi key={tile.key} s={s} t={t} metricKey={tile.key} label={tile.label} value={val(tile.key)} comparison={mom(tile.key)} caption={tile.caption} big />
            ))}
          </View>
          {r.annotations.length > 0 && (
            <View style={{ marginTop: 10 }}>
              {r.annotations.map((a) => (
                <Text key={a.date + a.label} style={[s.body, { marginTop: 2 }]}>
                  <Text style={{ color: t.accentText, fontWeight: 600 }}>{formatDay(a.date)}: </Text>
                  {a.label}
                </Text>
              ))}
            </View>
          )}
        </View>

        {/* Key terms */}
        <View style={s.section}>
          <Heading s={s} n={next()} title="Understanding Key Social Media Terms" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {GLOSSARY.map((g) => (
              <View key={g.id} wrap={false} style={[s.card, { width: "49%", padding: 8 }]}>
                <Text style={{ fontWeight: 600, color: t.accentText }}>{g.term}</Text>
                <Text style={[s.body, { fontSize: 8, marginTop: 2 }]}>{g.definition}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Social overview */}
        {socials.length > 0 && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Social Media Performance Overview" />
              <Text style={[s.body, { marginBottom: 8 }]}>
                Each platform keeps its own metric names and the dates it supplied. Only measures with the same name are combined.
              </Text>
              <Table
                s={s}
                t={t}
                left
                widths={[11, 15, 14, 12, 20, 15, 13]}
                head={["Platform", "Source period", "Ending audience", "Net new followers", "Visibility", "Engagement", "Posts published"]}
                rows={social.overview.map((o) => [o.label, o.period, o.audience, o.netNew, o.visibility, o.engagement, o.posts])}
                footer={social.combined ? ["Combined", social.combined.note, "", "", social.combined.views, social.combined.interactions, ""] : undefined}
              />
            </View>
            {social.visibilityBars.length > 1 && (
              <View wrap={false} style={[s.card, { marginTop: 10 }]}>
                <Text style={[s.h3, { fontSize: 10, marginBottom: 8 }]}>Supplied visibility measures by platform</Text>
                <Bars t={t} bars={social.visibilityBars} />
                {social.visibilityNote && <Text style={{ marginTop: 6, fontSize: 7.5, color: t.fgMuted }}>{social.visibilityNote}</Text>}
              </View>
            )}
          </View>
        )}

        {/* Platforms */}
        {socials.length > 0 && (
          <View style={s.section}>
            <Heading s={s} n={next()} title="Platform Performance Breakdown" />
            {social.platforms.map((p, i) => (
              <View key={p.source} wrap={false} style={[s.card, { marginTop: i ? 10 : 0, borderLeftWidth: 3, borderLeftColor: t.accent, padding: 12 }]}>
                <Chip label={p.label} color={p.color} />
                <Text style={[s.h3, { marginTop: 6 }]}>{p.headline}</Text>
                {p.body && <Text style={[s.body, { marginTop: 3 }]}>{p.body}</Text>}
                {p.sourcePeriod && <Text style={{ marginTop: 3, fontSize: 7.5, color: t.fgMuted }}>Platform totals for {p.sourcePeriod}, as supplied.</Text>}
                <View style={[s.row, { marginTop: 8 }]}>
                  {p.tiles.map((tile) => (
                    <Kpi key={tile.key} s={s} t={t} metricKey={tile.key} value={tile.numeric} comparison={tile.comparison} caption={tile.caption ?? undefined} />
                  ))}
                </View>
                {p.missingNote && <Text style={{ marginTop: 6, fontSize: 7.5, color: t.fgMuted }}>{p.missingNote}</Text>}
              </View>
            ))}
            {social.competitors && (
              <View wrap={false} style={{ marginTop: 14 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Chip label="LinkedIn" color={PLATFORM_COLORS.linkedin} />
                  <Text style={{ fontSize: 11, fontWeight: 600 }}>Competitor comparison</Text>
                  <Text style={{ fontSize: 7.5, color: t.fgMuted }}>As shown by LinkedIn for {social.competitors.period}</Text>
                </View>
                <CompetitorPdf s={s} t={t} table={social.competitors} />
              </View>
            )}
          </View>
        )}

        {/* Website */}
        {r.hasWebsite && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Website Performance" />
              {narratives.ga4?.body && <Text style={[s.body, { marginBottom: 8 }]}>{narratives.ga4.body}</Text>}
              <View style={s.row}>
                {r.websiteTiles.map((k) => (
                  <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                ))}
              </View>
              {r.salesTiles.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <Text style={[s.label, { marginBottom: 4 }]}>Online sales</Text>
                  <View style={s.row}>
                    {r.salesTiles.map((k) => (
                      <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                    ))}
                  </View>
                </View>
              )}
            </View>
            {(
              [
                ["Sessions by channel", "Channel", r.websiteChannels],
                ["Top landing pages", "Page", r.websitePages],
              ] as const
            )
              .filter(([, , table]) => table.rows.length > 0)
              .map(([title, first, table]) => {
                const rest = table.keys.length;
                const firstWidth = first === "Page" ? 100 - rest * 13 : 100 - rest * 14;
                return (
                  <View key={title} style={{ marginTop: 10 }} wrap={false}>
                    <Text style={[s.label, { marginBottom: 4 }]}>{title}</Text>
                    <Table
                      s={s}
                      t={t}
                      widths={[firstWidth, ...table.keys.map(() => (100 - firstWidth) / rest)]}
                      head={[first, ...table.keys.map((k) => WEBSITE_COLUMNS[k])]}
                      rows={table.rows.slice(0, 8).map((row) => [row.name, ...row.values.map((v, i) => formatMetric(table.keys[i], v))])}
                    />
                  </View>
                );
              })}
          </View>
        )}

        {/* Google Search */}
        {r.hasSearch && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Google Search Rankings" />
              {narratives.search_console?.body && <Text style={[s.body, { marginBottom: 8 }]}>{narratives.search_console.body}</Text>}
              <View style={s.row}>
                {["gsc_clicks", "gsc_impressions", "gsc_position", "gsc_ctr"].map((k) => (
                  <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                ))}
              </View>
            </View>
            {(
              [
                ["Top search terms", "Search term", r.searchQueries],
                ["Top pages from Google", "Page", r.searchPages],
              ] as const
            )
              .filter(([, , rows]) => rows.length > 0)
              .map(([title, first, rows]) => (
                <View key={title} style={{ marginTop: 10 }} wrap={false}>
                  <Text style={[s.label, { marginBottom: 4 }]}>{title}</Text>
                  <Table
                    s={s}
                    t={t}
                    widths={[44, 14, 14, 14, 14]}
                    head={[first, "Clicks", "Impressions", "Click Rate", "Avg. Position"]}
                    rows={rows.map((x) => [
                      x.name,
                      formatMetric("gsc_clicks", x.clicks),
                      formatMetric("gsc_impressions", x.impressions),
                      formatMetric("gsc_ctr", x.ctr),
                      formatMetric("gsc_position", x.position),
                    ])}
                  />
                </View>
              ))}
          </View>
        )}

        {/* Content */}
        {r.show.content && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Content and Engagement Analysis" />
              {notes.content && <Text style={[s.body, { marginBottom: 8 }]}>{notes.content}</Text>}
              {r.posts.length > 0 && (
                <Table
                  s={s}
                  t={t}
                  widths={[7, 13, 15, 11, 42, 12]}
                  head={["Rank", "Platform", "Published", "Format", "Post", "Views"]}
                  rows={r.posts.map((p, i) => [
                    String(i + 1),
                    SOURCE_LABELS[p.platform],
                    p.published_at ? formatDay(p.published_at.slice(0, 10)) : "Not available",
                    FORMAT_LABELS[p.format] ?? p.format,
                    p.summary ?? "",
                    formatMetric("ig_views", p.views),
                  ])}
                />
              )}
            </View>
            <View style={[s.row, { flexWrap: "wrap", marginTop: 8 }]}>
              {social.contentTypes.map((c) => (
                <View key={c.title} wrap={false} style={[s.card, { width: "49%" }]}>
                  <Text style={[s.label, { marginBottom: 6 }]}>{c.title}</Text>
                  <Bars t={t} bars={c.bars} />
                  {c.note && <Text style={{ marginTop: 5, fontSize: 7, color: t.fgMuted }}>{c.note}</Text>}
                </View>
              ))}
              {SOCIAL_SOURCES.filter((src) => snapshotsOf(r.snapshots, src, "format_engagement").length > 0).map((src) => (
                <ShareCard key={src} s={s} t={t} title={`${SOURCE_LABELS[src]} engagement by format`} items={snapshotsOf(r.snapshots, src, "format_engagement")} />
              ))}
            </View>
          </View>
        )}

        {/* Demographics */}
        {r.show.audience && (
          <View style={s.section}>
            <Grid
              columns={2}
              lead={
                <>
                  <Heading s={s} n={next()} title="Audience Growth and Demographics" />
                  {notes.demographics && <Text style={[s.body, { marginBottom: 8 }]}>{notes.demographics}</Text>}
                </>
              }
            >
              {SOCIAL_SOURCES.flatMap((src) =>
                DEMOGRAPHICS.filter((d) => snapshotsOf(r.snapshots, src, d.type).length > 0).map((d) => (
                  <ShareCard
                    key={`${src}-${d.type}`}
                    s={s}
                    t={t}
                    title={`${SOURCE_LABELS[src]} audience by ${d.title}`}
                    items={snapshotsOf(r.snapshots, src, d.type).sort((a, b) => (d.sortByBucket ? a.bucket.localeCompare(b.bucket) : b.share - a.share))}
                  />
                )),
              )}
            </Grid>
          </View>
        )}

        {/* Discovery */}
        {r.show.discovery && (
          <View style={s.section}>
            <Grid
              columns={2}
              lead={
                <>
                  <Heading s={s} n={next()} title="Visibility, Discovery, and Profile Activity" />
                  {notes.discovery && <Text style={[s.body, { marginBottom: 8 }]}>{notes.discovery}</Text>}
                  <View style={{ marginBottom: 8 }}>
                    <Table
                      s={s}
                      t={t}
                      left
                      widths={[13, 32, 33, 22]}
                      head={["Platform", "Profile or page activity", "Discovery or audience split", "Source period"]}
                      rows={social.discovery.map((d) => [d.label, d.activity.join("\n"), d.split.join("\n"), d.period])}
                    />
                  </View>
                </>
              }
            >
              {SOCIAL_SOURCES.flatMap((src) =>
                (["discovery_surface", "follower_status"] as const)
                  .filter((type) => snapshotsOf(r.snapshots, src, type).length > 0)
                  .map((type) => (
                    <ShareCard
                      key={`${src}-${type}`}
                      s={s}
                      t={t}
                      title={`${SOURCE_LABELS[src]} ${type === "discovery_surface" ? "views by where people found you" : "views from followers vs non-followers"}`}
                      items={snapshotsOf(r.snapshots, src, type)}
                    />
                  )),
              )}
            </Grid>
          </View>
        )}

        {/* Video */}
        {r.show.video && (
          <View style={s.section}>
            <Grid
              columns={3}
              lead={
                <>
                  <Heading s={s} n={next()} title="Video and Short-Form Content Performance" />
                  {notes.video && <Text style={[s.body, { marginBottom: 8 }]}>{notes.video}</Text>}
                </>
              }
            >
              {VIDEO_KEYS.filter((k) => val(k) !== null).map((k) => (
                <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} label={videoLabel(k)} />
              ))}
            </Grid>
          </View>
        )}

        {/* Ads */}
        {r.hasAds && r.adsRange && (
          <View style={s.section}>
            <View wrap={false}>
            <Heading s={s} n={next()} title="Meta Ad Performance" />
            <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: t.accent }]}>
              <Text style={s.eyebrow}>Meta Ads (paid) · {formatRange(r.adsRange)}</Text>
              <Text style={s.h3}>{narratives.meta_ads?.headline ?? `${formatMetric("ads_leads", val("ads_leads", r.adsRange))} Leads Generated`}</Text>
              {narratives.meta_ads?.body && <Text style={[s.body, { marginTop: 3 }]}>{narratives.meta_ads.body}</Text>}
              {r.campaigns.length > 0 && (
                <Text style={{ marginTop: 4, fontSize: 7.5, color: t.fgMuted }}>
                  {r.campaigns.length === 1 ? "Campaign" : "Campaigns"}: {r.campaigns.map((c) => c.name).join(", ")}
                </Text>
              )}
            </View>
            </View>
            <View style={[s.row, { marginTop: 8 }]} wrap={false}>
              <Kpi s={s} t={t} metricKey="ads_leads" label="Leads Generated" value={val("ads_leads", r.adsRange)} comparison={r.adsCmp("ads_leads")} caption={formatRange(r.adsRange)} />
              <Kpi s={s} t={t} metricKey="ads_reach" label="Total Reach" value={val("ads_reach", r.adsRange)} comparison={r.adsCmp("ads_reach")} caption="Different people reached" />
              <Kpi s={s} t={t} metricKey="ads_spend" value={val("ads_spend", r.adsRange)} comparison={r.adsCmp("ads_spend")} caption={`${daysBetween(r.adsRange)} days of activity`} />
            </View>
            <View style={{ marginTop: 8 }} wrap={false}>
              <Table
                s={s}
                t={t}
                widths={[24, 18, 58]}
                head={["Metric", "Value", "What it means"]}
                rows={ADS_TABLE.map(({ key, meaning }) => [METRICS[key].label, formatMetric(key, val(key, r.adsRange!)), meaning])}
                highlight={1}
              />
            </View>
          </View>
        )}

        {/* Google Ads */}
        {r.hasGoogleAds && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Google Ads Performance" />
              <View style={[s.card, { borderLeftWidth: 3, borderLeftColor: t.accent }]}>
                <Text style={s.eyebrow}>Google Ads (paid) · {describeRange(range)}</Text>
                <Text style={s.h3}>
                  {narratives.google_ads?.headline ??
                    (val("gads_conversions") !== null
                      ? `${formatMetric("gads_conversions", val("gads_conversions"))} Conversions from ${formatMetric("gads_clicks", val("gads_clicks"))} Clicks`
                      : `${formatMetric("gads_clicks", val("gads_clicks"))} Clicks`)}
                </Text>
                {narratives.google_ads?.body && <Text style={[s.body, { marginTop: 3 }]}>{narratives.google_ads.body}</Text>}
              </View>
              <View style={[s.row, { marginTop: 8 }]}>
                {["gads_conversions", "gads_spend", "gads_cpa"].map((k) => (
                  <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                ))}
              </View>
            </View>
            <View style={{ marginTop: 8 }} wrap={false}>
              <Table
                s={s}
                t={t}
                widths={[26, 18, 56]}
                head={["Metric", "Value", "What it means"]}
                rows={GOOGLE_ADS_TABLE.filter(({ key }) => val(key) !== null).map(({ key, meaning }) => [METRICS[key].label, formatMetric(key, val(key)), meaning])}
                highlight={1}
              />
            </View>
            {(
              [
                ["Top search terms by clicks", "Search term", r.googleSearchTerms],
                ["Top keywords by clicks", "Keyword", r.googleKeywords],
              ] as const
            )
              .filter(([, , rows]) => rows.length > 0)
              .map(([title, col, rows]) => (
                <View key={title} style={{ marginTop: 8 }} wrap={false}>
                  <Text style={[s.label, { marginBottom: 4 }]}>{title}</Text>
                  <Table
                    s={s}
                    t={t}
                    widths={[40, 15, 15, 15, 15]}
                    head={[col, "Clicks", "Impressions", "Cost", "Conversions"]}
                    rows={rows.map((x) => [
                      x.name,
                      formatMetric("gads_clicks", x.clicks),
                      formatMetric("gads_impressions", x.impressions),
                      formatMetric("gads_spend", x.spend),
                      formatMetric("gads_conversions", x.conversions),
                    ])}
                  />
                </View>
              ))}
            {r.googleCampaigns.length > 0 && (
              <View style={{ marginTop: 8 }} wrap={false}>
                <Text style={[s.label, { marginBottom: 4 }]}>By campaign</Text>
                <Table
                  s={s}
                  t={t}
                  widths={[40, 15, 15, 15, 15]}
                  head={["Campaign", "Cost", "Clicks", "Conversions", "Cost per conv."]}
                  rows={r.googleCampaigns.map((c) => [
                    c.name,
                    formatMetric("gads_spend", c.spend),
                    formatMetric("gads_clicks", c.clicks),
                    formatMetric("gads_conversions", c.conversions),
                    formatMetric("gads_cpa", c.cpa),
                  ])}
                />
              </View>
            )}
            {r.googleAuction.length > 0 && (
              <View style={{ marginTop: 8 }} wrap={false}>
                <Text style={[s.label, { marginBottom: 4 }]}>Auction insights</Text>
                <Table
                  s={s}
                  t={t}
                  widths={[28, 12, 12, 12, 12, 12, 12]}
                  head={["Advertiser", ...AUCTION_KEYS.map((k) => AUCTION_LABELS[k])]}
                  rows={r.googleAuction.map((a) => [
                    a.you ? "You" : a.name,
                    ...a.values.map((v, i) => (v === null ? (i === 0 && !a.you ? "Under 10%" : "--") : formatMetric(AUCTION_KEYS[i], v))),
                  ])}
                />
              </View>
            )}
            {r.googleDemographics.length > 0 && (
              <View style={[s.row, { marginTop: 8 }]} wrap={false}>
                {r.googleDemographics.map((d) => (
                  <ShareCard key={d.type} s={s} t={t} title={d.title} items={d.items} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Comparison */}
        {(r.momKeys.length > 0 || social.compareCards.length > 0) && r.compareRange && (
          <View style={s.section}>
            <Grid
              columns={4}
              lead={
                <>
                  <Heading s={s} n={next()} title={r.compareTitle} />
                  <Text style={[s.body, { marginBottom: 8 }]}>
                    {period.label} compared with {period.compareLabel}.
                  </Text>
                  {social.compareCards.length > 0 && (
                    <View style={[s.row, { marginBottom: 8 }]}>
                      {social.compareCards.map((c) => {
                        const hc = c.headline?.comparison;
                        const color = hc?.sentiment === "positive" ? t.positive : hc?.sentiment === "negative" ? t.negative : t.fgMuted;
                        return (
                          <View key={c.source} style={[s.card, { flex: 1 }]}>
                            <Chip label={c.label} color={c.color} />
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, marginBottom: 4 }}>
                              {hc && hc.direction && hc.direction !== "flat" && <Triangle up={hc.direction === "up"} color={color} size={9} />}
                              <Text style={{ fontSize: c.headline ? 18 : 12, fontWeight: 600, color, lineHeight: 1.2 }}>{c.headline?.text ?? "No comparison"}</Text>
                            </View>
                            {c.lines.map((l) => {
                              const lc = l.comparison?.sentiment === "positive" ? t.positive : l.comparison?.sentiment === "negative" ? t.negative : t.fgSecondary;
                              return (
                                <Text key={l.label} style={{ fontSize: 7.5, marginTop: 3, color: lc }}>
                                  <Text style={{ fontWeight: 600, color: t.fg }}>{l.label}: </Text>
                                  {l.text}
                                </Text>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </>
              }
            >
              {r.momKeys.map((k) => {
                const c = mom(k)!;
                const def = METRICS[k];
                const prefix = def.source === "combined" ? "" : `${SOURCE_LABELS[def.source as DataSource]} `;
                const color = c.sentiment === "positive" ? t.positive : c.sentiment === "negative" ? t.negative : t.fgSecondary;
                return (
                  <View key={k} wrap={false} style={[s.card, { flex: 1, borderTopWidth: 2.5, borderTopColor: c.sentiment ? color : t.line }]}>
                    <Text style={[s.label, { fontSize: 6.5 }]}>{`${prefix}${def.label}`}</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 5 }}>
                      {c.direction && c.direction !== "flat" && <Triangle up={c.direction === "up"} color={color} size={8} />}
                      <Text style={{ fontSize: 16, fontWeight: 600, color }}>{c.pctChange === null ? "New" : formatPctChange(c.pctChange)}</Text>
                    </View>
                    <Text style={{ marginTop: 4, fontSize: 7.5, color: t.fgSecondary }}>
                      {formatMetric(k, c.previous)} to <Text style={{ color: t.fg, fontWeight: 600 }}>{formatMetric(k, c.current)}</Text>
                    </Text>
                  </View>
                );
              })}
            </Grid>
            {social.limitations.length > 0 && (
              <View wrap={false} style={[s.card, { marginTop: 8, borderColor: t.accent }]}>
                <Text style={{ fontSize: 9.5, fontWeight: 600, color: t.accentText, marginBottom: 4 }}>Comparison limitations</Text>
                {social.limitations.map((l) => (
                  <Text key={l} style={{ fontSize: 8, color: t.fgSecondary, marginTop: 2 }}>
                    • {l}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Trends */}
        {r.trends.length > 0 && (
          <View style={s.section}>
            <Grid
              columns={2}
              lead={
                <>
                  <Heading s={s} n={next()} title="Monthly Trends" />
                  <Text style={[s.body, { marginBottom: 8 }]}>
                    Month by month, {formatMonth(r.months[0])} to {formatMonth(r.months.at(-1)!)}. Solid line: these months. Dashed line: the same month a
                    year earlier.{r.chartAnnotations.length ? " Dotted markers: logged events." : ""}
                  </Text>
                </>
              }
            >
              {r.trends.map((series) => (
                <TrendChart key={series.key} s={s} t={t} series={series} eventMonths={new Set(r.chartAnnotations.map((a) => a.month))} />
              ))}
            </Grid>
          </View>
        )}

        {/* Conclusion */}
        {commentary?.conclusion && (
          <View style={s.section} wrap={false}>
            <Heading s={s} n={next()} title="Conclusion" />
            <View style={{ backgroundColor: t.conclusionBg, borderRadius: 8, padding: 16, borderLeftWidth: 3, borderLeftColor: t.accent }}>
              <Paragraphs text={commentary.conclusion} style={{ color: t.conclusionText, fontSize: 9.5, lineHeight: 1.6 }} />
            </View>
          </View>
        )}
        {/* Sources */}
        {social.sourceNotes.length > 0 && (
          <View style={s.section} wrap={false}>
            <Text style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Source and methodology notes</Text>
            <View style={s.card}>
              {[...social.sourceNotes, { label: "Calculation policy", text: "No estimates are shown as fact. Only measures with the same name are combined, and rates are calculated from their parts. Anything a platform did not supply is marked Not available." }].map((n, i) => (
                <View key={n.label} style={{ flexDirection: "row", gap: 6, paddingVertical: 4, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.line }}>
                  <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: t.accent, marginTop: 3 }} />
                  <Text style={{ flex: 1, fontSize: 8, color: t.fgSecondary }}>
                    <Text style={{ fontWeight: 600, color: t.fg }}>{n.label}: </Text>
                    {n.text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function Heading({ s, n, title }: { s: S; n: number; title: string }) {
  return (
    <Text style={s.h2} minPresenceAhead={80}>
      <Text style={{ color: s.eyebrow.color as string }}>{n}. </Text>
      {title}
    </Text>
  );
}

/**
 * Cards in rows of `columns`. The heading block stays on the same page as the
 * first row, so a heading is never left alone at the bottom of a page.
 */
function Grid({ columns, lead, children }: { columns: number; lead: React.ReactNode; children: React.ReactNode }) {
  const items = (Array.isArray(children) ? children.flat(Infinity) : [children]).filter(Boolean) as React.ReactNode[];
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) rows.push(items.slice(i, i + columns));
  const row = (cells: React.ReactNode[], key: number) => (
    <View key={key} style={{ flexDirection: "row", gap: 8, marginTop: key ? 8 : 0 }} wrap={false}>
      {cells}
      {Array.from({ length: columns - cells.length }, (_, i) => (
        <View key={`pad${i}`} style={{ flex: 1 }} />
      ))}
    </View>
  );
  return (
    <>
      <View wrap={false}>
        {lead}
        {rows[0] && row(rows[0], 0)}
      </View>
      {rows.slice(1).map((cells, i) => row(cells, i + 1))}
    </>
  );
}

/** Platform label in the platform's brand color (only labels and bars use brand colors). */
function Chip({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: color, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 }}>
      <Text style={{ fontSize: 6.5, fontWeight: 700, letterSpacing: 0.8, color: "#ffffff", textTransform: "uppercase" }}>{label}</Text>
    </View>
  );
}

function Bars({ t, bars }: { t: PdfTheme; bars: Bar[] }) {
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  return (
    <View>
      {bars.map((b) => (
        <View key={b.label} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <Text style={{ width: "30%", fontSize: 8, color: t.fgSecondary }}>{b.label}</Text>
          <View style={{ flex: 1, height: 7, backgroundColor: t.raised, borderRadius: 4 }}>
            <View style={{ height: 7, width: `${Math.max(1, (b.value / max) * 100)}%`, backgroundColor: b.color, borderRadius: 4 }} />
          </View>
          <Text style={{ width: 44, textAlign: "right", fontSize: 8, fontWeight: 600, color: t.fg }}>{b.display}</Text>
        </View>
      ))}
    </View>
  );
}

function CompetitorPdf({ s, t, table }: { s: S; t: PdfTheme; table: CompetitorTable }) {
  const w = 60 / table.columns.length;
  return (
    <View style={{ borderWidth: 0.75, borderColor: t.line, borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", backgroundColor: t.tableHead }}>
        <Text style={[s.label, { width: "8%", padding: 6, color: t.tableHeadText, fontSize: 6.5 }]}>Rank</Text>
        <Text style={[s.label, { width: "32%", padding: 6, color: t.tableHeadText, fontSize: 6.5 }]}>Company</Text>
        {table.columns.map((c) => (
          <Text key={c.metric} style={[s.label, { width: `${w}%`, padding: 6, color: t.tableHeadText, fontSize: 6.5, textAlign: "right" }]}>
            {c.label}
          </Text>
        ))}
      </View>
      {table.rows.map((r, ri) => (
        <View key={r.company} style={{ flexDirection: "row", alignItems: "center", backgroundColor: r.own ? (t.name === "print" ? "#e6fbfb" : t.heroBg) : ri % 2 ? t.raised : t.surface, borderTopWidth: 0.5, borderTopColor: t.line }}>
          <Text style={{ width: "8%", padding: 6, fontSize: 8, color: t.fgSecondary }}>{r.rank}</Text>
          <View style={{ width: "32%", padding: 6, flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 8, fontWeight: 600, color: t.fg }}>{r.company}</Text>
            {r.own && <Text style={{ fontSize: 6.5, color: t.accentText, borderWidth: 0.5, borderColor: t.accentText, borderRadius: 2, paddingHorizontal: 2 }}>Your Page</Text>}
          </View>
          {table.columns.map((c) => {
            const cell = r.cells[c.metric];
            const color = cell && cell.change !== null && cell.change < 0 ? t.negative : t.positive;
            return (
              <View key={c.metric} style={{ width: `${w}%`, padding: 6, alignItems: "flex-end" }}>
                <Text style={{ fontSize: 8, fontWeight: 600, color: cell ? t.fg : t.fgMuted }}>{cell?.value ?? "Not available"}</Text>
                {cell && cell.change !== null && cell.change !== 0 && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                    <Triangle up={cell.change > 0} color={color} size={5} />
                    <Text style={{ fontSize: 7, color }}>{Math.abs(cell.change * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%</Text>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function Paragraphs({ text, style }: { text: string; style: Style }) {
  return (
    <View>
      {text.split(/\n{2,}/).map((p, i) => (
        <Text key={i} style={[style, i ? { marginTop: 6 } : {}]}>
          {p}
        </Text>
      ))}
    </View>
  );
}

function Triangle({ up, color, size }: { up: boolean; color: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 10 10">
      <Polyline points={up ? "0,9 5,1 10,9 0,9" : "0,1 5,9 10,1 0,1"} fill={color} stroke={color} strokeWidth={0} />
    </Svg>
  );
}

function Kpi({
  s,
  t,
  metricKey,
  value,
  comparison,
  label,
  caption,
  big,
}: {
  s: S;
  t: PdfTheme;
  metricKey: string;
  value: number | null;
  comparison?: Comparison | null;
  label?: string;
  caption?: string;
  big?: boolean;
}) {
  const c = comparison && comparison.direction !== null ? comparison : null;
  const color = c?.sentiment === "positive" ? t.positive : c?.sentiment === "negative" ? t.negative : t.fgSecondary;
  return (
    <View wrap={false} style={[s.card, { flex: 1, borderTopWidth: 2, borderTopColor: t.accent }]}>
      <Text style={{ fontSize: big ? 22 : 18, fontWeight: 600, color: t.accentText, lineHeight: 1.15 }}>{formatMetric(metricKey, value)}</Text>
      <Text style={[s.label, { marginTop: 4 }]}>{label ?? METRICS[metricKey]?.label ?? metricKey}</Text>
      {caption && <Text style={{ fontSize: 7, color: t.fgMuted, marginTop: 2 }}>{caption}</Text>}
      {c && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6, flexWrap: "wrap" }}>
          {c.direction !== "flat" && <Triangle up={c.direction === "up"} color={color} size={6} />}
          <Text style={{ fontSize: 7.5, fontWeight: 600, color }}>
            {c.pctChange === null ? "New" : formatPctChange(c.pctChange)}
            {c.delta !== null && c.delta !== 0 ? ` (${formatDelta(metricKey, c.delta)})` : ""}
          </Text>
          <Text style={{ fontSize: 7, color: t.fgMuted }}> vs {formatMetric(metricKey, c.previous)}</Text>
        </View>
      )}
    </View>
  );
}

function Table({
  s,
  t,
  head,
  rows,
  footer,
  widths,
  highlight,
  left,
}: {
  s: S;
  t: PdfTheme;
  head: string[];
  rows: string[][];
  footer?: string[];
  widths: number[];
  /** Left-align every column (tables of text rather than numbers). */
  left?: boolean;
  /** Column shown in teal and bold. */
  highlight?: number;
}) {
  const cell = (i: number): Style => ({ width: `${widths[i]}%`, paddingVertical: 5, paddingHorizontal: 6, textAlign: left || i === 0 || widths[i] > 40 ? "left" : "right" });
  return (
    <View style={{ borderWidth: 0.75, borderColor: t.line, borderRadius: 6, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", backgroundColor: t.tableHead }}>
        {head.map((h, i) => (
          <Text key={i} style={[cell(i), s.label, { color: t.tableHeadText, fontSize: 6.5 }]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={{ flexDirection: "row", backgroundColor: ri % 2 ? t.raised : t.surface, borderTopWidth: 0.5, borderTopColor: t.line }}>
          {row.map((v, i) => (
            <Text
              key={i}
              style={[cell(i), { fontSize: 8, color: i === highlight ? t.accentText : i === 0 ? t.fg : t.fgSecondary, fontWeight: i === highlight ? 600 : 400 }]}
            >
              {v}
            </Text>
          ))}
        </View>
      ))}
      {footer && (
        <View style={{ flexDirection: "row", backgroundColor: t.raised, borderTopWidth: 1, borderTopColor: t.accent }}>
          {footer.map((v, i) => (
            <Text key={i} style={[cell(i), { fontSize: 8, fontWeight: 600, color: i === 0 ? t.fg : t.accentText }]}>
              {v}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

function ShareCard({ s, t, title, items }: { s: S; t: PdfTheme; title: string; items: { bucket: string; share: number }[] }) {
  return (
    <View wrap={false} style={[s.card, { flex: 1 }]}>
      <Text style={[s.label, { marginBottom: 6 }]}>{title}</Text>
      {items.slice(0, 8).map((it) => (
        <View key={it.bucket} style={{ marginBottom: 5 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", fontSize: 8 }}>
            <Text style={{ color: t.fg }}>{it.bucket}</Text>
            <Text style={{ color: t.accentText, fontWeight: 600 }}>{formatValue(it.share, "percent")}</Text>
          </View>
          <View style={{ height: 3, backgroundColor: t.raised, borderRadius: 2, marginTop: 2 }}>
            <View style={{ height: 3, width: `${Math.max(1, Math.min(100, it.share * 100))}%`, backgroundColor: t.accent, borderRadius: 2 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
function axis(v: number, format: TrendSeries["format"]) {
  if (format === "percent") return `${Math.round(v * 100)}%`;
  if (format === "currency") return `$${compact.format(v)}`;
  return compact.format(v);
}

/** A small line chart: these months solid, a year earlier dashed, events dotted. */
function TrendChart({ s, t, series, eventMonths }: { s: S; t: PdfTheme; series: TrendSeries; eventMonths: Set<string> }) {
  const W = 240;
  const H = 70;
  const pts = series.points;
  const all = pts.flatMap((p) => [p.value, p.previous]).filter((v): v is number => v !== null);
  const max = Math.max(...all, 0) * 1.1 || 1;
  const x = (i: number) => (pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * (W - 8) + 4);
  const y = (v: number) => H - 4 - (v / max) * (H - 10);
  const line = (key: "value" | "previous") =>
    pts
      .map((p, i) => (p[key] === null ? null : `${x(i).toFixed(1)},${y(p[key]!).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  const latest = [...pts].reverse().find((p) => p.value !== null);
  const labelIdx = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];

  return (
    <View wrap={false} style={[s.card, { flex: 1 }]}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={[s.label, { maxWidth: "65%" }]}>{series.label}</Text>
        {latest && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 11, fontWeight: 600, color: t.accentText }}>{formatValue(latest.value, series.format)}</Text>
            <Text style={{ fontSize: 6.5, color: t.fgMuted }}>
              {latest.fullLabel}
              {latest.partial ? " (so far)" : ""}
            </Text>
          </View>
        )}
      </View>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        <View style={{ width: 26, justifyContent: "space-between", height: H }}>
          <Text style={{ fontSize: 6, color: t.fgMuted }}>{axis(max / 1.1, series.format)}</Text>
          <Text style={{ fontSize: 6, color: t.fgMuted }}>0</Text>
        </View>
        <Svg width={W} height={H}>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <Line key={f} x1={0} x2={W} y1={y((max / 1.1) * f)} y2={y((max / 1.1) * f)} stroke={t.grid} strokeWidth={0.5} />
          ))}
          <Line x1={0} x2={W} y1={H - 4} y2={H - 4} stroke={t.line} strokeWidth={0.75} />
          {pts.map((p, i) =>
            eventMonths.has(p.month) ? <Line key={p.month} x1={x(i)} x2={x(i)} y1={2} y2={H - 4} stroke={t.accent} strokeWidth={0.75} strokeDasharray="1,2" /> : null,
          )}
          {line("previous") && <Polyline points={line("previous")} fill="none" stroke={t.accentDeep} strokeWidth={1} strokeDasharray="3,2" />}
          <Polyline points={line("value")} fill="none" stroke={t.accent} strokeWidth={1.6} />
          {pts.map((p, i) => (p.value === null ? null : <Rect key={i} x={x(i) - 1.2} y={y(p.value) - 1.2} width={2.4} height={2.4} fill={t.accent} />))}
        </Svg>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginLeft: 26, marginTop: 2 }}>
        {labelIdx.map((i) => (
          <Text key={i} style={{ fontSize: 6, color: t.fgMuted }}>
            {pts[i]?.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
