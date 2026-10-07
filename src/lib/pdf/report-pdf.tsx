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
import { ADS_TABLE, FORMAT_LABELS, PLATFORM_TILES, snapshotsOf, type Report } from "@/lib/report/load";
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
  const { period, range, val, mom, socials, narratives, notes, commentary } = r;
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
          <View style={s.section} wrap={false}>
            <Heading s={s} n={next()} title="Social Media Performance Overview" />
            <Table
              s={s}
              t={t}
              widths={[28, 18, 18, 18, 18]}
              head={["Platform", "Ending Audience", "Net New Followers", "Total Views / Reach", "Total Interactions"]}
              rows={socials.map((src) => {
                const k = SOCIAL_OVERVIEW_KEYS[src];
                const net = val(k.netNew);
                return [
                  SOURCE_LABELS[src],
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
          </View>
        )}

        {/* Platforms */}
        {socials.length > 0 && (
          <View style={s.section}>
            <Heading s={s} n={next()} title="Platform Performance Breakdown" />
            {socials.map((src, i) => {
              const cfg = PLATFORM_TILES[src];
              const nar = narratives[src];
              const [viewsKey, intKey] = cfg.headline;
              return (
                <View key={src} wrap={false} style={{ marginTop: i ? 14 : 0, borderLeftWidth: 2, borderLeftColor: t.accent, paddingLeft: 10 }}>
                  <Text style={s.eyebrow}>
                    {i + 1} · {SOURCE_LABELS[src]}
                  </Text>
                  <Text style={s.h3}>
                    {nar?.headline ??
                      `${formatMetric(viewsKey, val(viewsKey))} ${METRICS[viewsKey].label}, ${formatMetric(intKey, val(intKey))} ${METRICS[intKey].label}`}
                  </Text>
                  {nar?.body && <Text style={[s.body, { marginTop: 3 }]}>{nar.body}</Text>}
                  <View style={[s.row, { marginTop: 8 }]}>
                    {cfg.keys.map((k) => (
                      <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                    ))}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Website */}
        {r.hasWebsite && (
          <View style={s.section}>
            <View wrap={false}>
              <Heading s={s} n={next()} title="Website Performance" />
              {narratives.ga4?.body && <Text style={[s.body, { marginBottom: 8 }]}>{narratives.ga4.body}</Text>}
              <View style={s.row}>
                {["ga4_sessions", "ga4_engagement_rate", "ga4_key_events"].map((k) => (
                  <Kpi key={k} s={s} t={t} metricKey={k} value={val(k)} comparison={mom(k)} />
                ))}
              </View>
            </View>
            <View style={[s.row, { marginTop: 10 }]}>
              <View style={{ flex: 1 }} wrap={false}>
                <Text style={[s.label, { marginBottom: 4 }]}>Sessions by channel</Text>
                <Table
                  s={s}
                  t={t}
                  widths={[40, 20, 20, 20]}
                  head={["Channel", "Sessions", "Engagement", "Key Events"]}
                  rows={r.resolver
                    .breakdown("ga4_sessions", "channel", range)
                    .slice(0, 8)
                    .map(({ bucket, value }) => {
                      const f = { dimension: "channel", value: bucket };
                      return [
                        bucket,
                        formatMetric("ga4_sessions", value),
                        formatMetric("ga4_engagement_rate", r.resolver.resolve("ga4_engagement_rate", range, f).value),
                        formatMetric("ga4_key_events", r.resolver.resolve("ga4_key_events", range, f).value),
                      ];
                    })}
                />
              </View>
              <View style={{ flex: 1 }} wrap={false}>
                <Text style={[s.label, { marginBottom: 4 }]}>Top landing pages</Text>
                <Table
                  s={s}
                  t={t}
                  widths={[60, 20, 20]}
                  head={["Page", "Views", "Key Events"]}
                  rows={r.resolver
                    .breakdown("ga4_page_views", "landing_page", range)
                    .slice(0, 8)
                    .map(({ bucket, value }) => [
                      bucket,
                      formatMetric("ga4_page_views", value),
                      formatMetric("ga4_key_events", r.resolver.resolve("ga4_key_events", range, { dimension: "landing_page", value: bucket }).value),
                    ])}
                />
              </View>
            </View>
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
                  widths={[15, 15, 55, 15]}
                  head={["Platform", "Format", "Post", "Views"]}
                  rows={r.posts.map((p) => [SOURCE_LABELS[p.platform], FORMAT_LABELS[p.format] ?? p.format, p.summary ?? "", formatMetric("ig_views", p.views)])}
                />
              )}
            </View>
            <View style={[s.row, { flexWrap: "wrap", marginTop: 8 }]}>
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
                (["age", "gender", "country", "language"] as const)
                  .filter((type) => snapshotsOf(r.snapshots, src, type).length > 0)
                  .map((type) => (
                    <ShareCard
                      key={`${src}-${type}`}
                      s={s}
                      t={t}
                      title={`${SOURCE_LABELS[src]} audience by ${type === "age" ? "age range" : type === "country" ? "top countries" : type === "language" ? "top languages" : type}`}
                      items={snapshotsOf(r.snapshots, src, type).sort((a, b) => (type === "age" ? a.bucket.localeCompare(b.bucket) : b.share - a.share))}
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
          <View style={s.section} wrap={false}>
            <Heading s={s} n={next()} title="Video and Short-Form Content Performance" />
            {notes.video && <Text style={[s.body, { marginBottom: 8 }]}>{notes.video}</Text>}
            <View style={s.row}>
              {["ig_reels_views", "fb_reels_engagement_share", "ig_reels_interactions"]
                .filter((k) => val(k) !== null)
                .map((k) => (
                  <Kpi
                    key={k}
                    s={s}
                    t={t}
                    metricKey={k}
                    value={val(k)}
                    comparison={mom(k)}
                    label={`${METRICS[k].source === "meta_instagram" ? "IG" : "FB"} ${METRICS[k].label}`}
                  />
                ))}
            </View>
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

        {/* Comparison */}
        {r.momKeys.length > 0 && r.compareRange && (
          <View style={s.section}>
            <Grid
              columns={4}
              lead={
                <>
                  <Heading s={s} n={next()} title={r.compareTitle} />
                  <Text style={[s.body, { marginBottom: 8 }]}>
                    {period.label} compared with {period.compareLabel}.
                  </Text>
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
}: {
  s: S;
  t: PdfTheme;
  head: string[];
  rows: string[][];
  footer?: string[];
  widths: number[];
  /** Column shown in teal and bold. */
  highlight?: number;
}) {
  const cell = (i: number): Style => ({ width: `${widths[i]}%`, paddingVertical: 5, paddingHorizontal: 6, textAlign: i === 0 || widths[i] > 40 ? "left" : "right" });
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
