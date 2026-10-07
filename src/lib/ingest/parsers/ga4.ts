/**
 * Google Analytics 4 report downloads (Reports > any report > Share > Download
 * File > CSV), and XLSX/CSV exported from Explorations.
 *
 * Format: "#" metadata lines (including "# Start date: 20260701" and
 * "# End date: 20260731"), then one or more tables separated by blank lines.
 * Tables either have a Date / "Nth day" column (daily rows) or not (totals for
 * the report's date range). Chart-series tables whose columns are dimension
 * values rather than metrics are skipped.
 */
import { addDays, norm, num, parseDate, rate } from "../cells";
import type { BatchBuilder } from "../batch";
import { splitBlocks } from "../table";
import type { ParseContext, Parser, Period, Sheet } from "../types";
import { cell, headerSet, hasAny, mapHeaders, missingPeriodMessage } from "./common";

const METRIC_COLUMNS = {
  sessions: ["Sessions"],
  engaged: ["Engaged sessions"],
  engagementRate: ["Engagement rate"],
  keyEvents: ["Key events", "Conversions"],
  users: ["Total users", "Users", "Active users"],
  views: ["Views", "Screen page views", "Views (screen and page views)", "Page views"],
};

const DIMENSIONS: { dimension: string; headers: string[] }[] = [
  {
    dimension: "channel",
    headers: [
      "Session primary channel group (Default Channel Group)",
      "Session default channel group",
      "Session primary channel group",
      "Default channel group",
      "First user primary channel group (Default Channel Group)",
      "First user default channel group",
      "Primary channel group (Default Channel Group)",
    ],
  },
  { dimension: "landing_page", headers: ["Landing page", "Landing page + query string"] },
  { dimension: "page", headers: ["Page path and screen class", "Page path", "Page path + query string", "Page title and screen class", "Page title"] },
  { dimension: "source_medium", headers: ["Session source / medium", "Session source/medium", "First user source / medium"] },
  { dimension: "city", headers: ["City"] },
  { dimension: "country", headers: ["Country"] },
  { dimension: "device", headers: ["Device category"] },
];

const DATE_HEADERS = ["Date", "Nth day"];
const IGNORE = [
  "Average engagement time*",
  "Events per session",
  "Event count",
  "Session key event rate",
  "User key event rate",
  "Session conversion rate",
  "Total revenue",
  "New users",
  "Returning users",
  "Views per session",
  "Views per user",
  "Bounce rate",
  "Engaged sessions per active user",
  "Average session duration",
  "Sessions per user",
  "Event count per user",
  "Engagement time",
];

export const ga4Parser: Parser = {
  id: "ga4_report",
  label: "Google Analytics 4 report export",
  sources: ["ga4"],

  detect(sheets) {
    let score = 0;
    for (const s of sheets) {
      const text = s.rows.slice(0, 12).map((r) => r.join(",")).join("\n");
      if (/^#.*(Start date|Property):/im.test(text)) score = Math.max(score, 0.95);
      const h = headerSet(s.rows, 40);
      if (hasAny(h, "Engaged sessions", "Engagement rate", "Key events") && hasAny(h, "Sessions", "Active users", "Total users")) {
        score = Math.max(score, 0.9);
      }
    }
    return score;
  },

  parse(sheets, ctx, out) {
    for (const sheet of sheets) parseSheet(sheet, ctx, out);
  },
};

function parseSheet(sheet: Sheet, ctx: ParseContext, out: BatchBuilder) {
  const { comments, blocks } = splitBlocks(sheet.rows);
  const meta = (label: string) => {
    const line = comments.find((c) => c.toLowerCase().startsWith(label.toLowerCase()));
    return line ? parseDate(line.slice(label.length).replace(/[:,\s]/g, "")) : null;
  };
  const start = meta("Start date") ?? ctx.period?.start ?? null;
  const end = meta("End date") ?? ctx.period?.end ?? null;
  const filePeriod: Period | null = start && end ? { start, end } : null;
  if (meta("Start date") && ctx.period && (ctx.period.start !== start || ctx.period.end !== end)) {
    out.warn(`The file covers ${start} to ${end}; the dates you entered were ignored.`);
  }

  // Track which metric+dimension combinations came with no dimension, so we
  // only derive channel totals when the file has no explicit totals.
  const explicitTotals = new Set<string>();
  const channelSums = new Map<string, number>();

  for (const block of blocks) {
    const headers = block[0];
    const dateIdx = headers.findIndex((h) => DATE_HEADERS.some((d) => norm(d) === norm(h)));
    const dim = DIMENSIONS.map((d) => ({ ...d, idx: headers.findIndex((h) => d.headers.some((x) => norm(x) === norm(h))) })).find(
      (d) => d.idx >= 0,
    );
    const { idx, mapped, unmapped } = mapHeaders(headers, METRIC_COLUMNS, [...IGNORE, ...DATE_HEADERS]);
    const hasMetrics = Object.values(idx).some((i) => (i as number) >= 0);
    if (!hasMetrics) continue; // chart series or a table we do not use

    out.columns(
      [...mapped, ...(dateIdx >= 0 ? [headers[dateIdx]] : []), ...(dim ? [headers[dim.idx]] : [])],
      unmapped.filter((h) => !dim || h !== headers[dim.idx]),
    );
    if (dateIdx < 0 && !filePeriod) {
      out.error(missingPeriodMessage("Google Analytics"));
      return;
    }
    if (idx.engaged < 0 && idx.engagementRate >= 0 && idx.sessions >= 0) {
      out.warn("Engaged sessions were calculated from the engagement rate column.");
    }
    const nthDay = dateIdx >= 0 && norm(headers[dateIdx]) === "nth day";
    if (nthDay && !filePeriod) {
      out.error("This file uses day numbers (Nth day) but has no start date. Enter the period and preview again.");
      return;
    }

    for (const row of block.slice(1)) {
      const first = norm(row[0] ?? "");
      if (first === "grand total" || first === "total" || first === "totals") continue;
      out.rowsRead++;

      let when: { date: string } | Period;
      if (dateIdx >= 0) {
        const raw = row[dateIdx];
        const date = nthDay ? (num(raw) !== null ? addDays(filePeriod!.start, num(raw)!) : null) : parseDate(raw);
        if (!date) {
          out.warn(`Skipped a row with an unreadable date ("${raw}").`);
          continue;
        }
        when = { date };
      } else when = filePeriod!;

      const dimension = dim?.dimension ?? "";
      const dimValue = dim ? (row[dim.idx] || "(not set)") : "";
      const sessions = num(cell(row, idx.sessions));
      let engaged = num(cell(row, idx.engaged));
      if (engaged === null && sessions !== null && idx.engagementRate >= 0) {
        const r = rate(cell(row, idx.engagementRate));
        engaged = r === null ? null : Math.round(r * sessions);
      }
      const values: [string, number | null][] = [
        ["ga4_sessions", sessions],
        ["ga4_engaged_sessions", engaged],
        ["ga4_key_events", num(cell(row, idx.keyEvents))],
        ["ga4_page_views", num(cell(row, idx.views))],
        ["ga4_users", num(cell(row, idx.users))],
      ];

      for (const [key, value] of values) {
        if (value === null) continue;
        // Users are unique counts: a daily file gives daily users, a total
        // file gives the exact figure for the period.
        out.value("ga4", key, when, value, dimension, dimValue);
        const whenKey = "date" in when ? when.date : `${when.start}|${when.end}`;
        if (!dim) explicitTotals.add(`${key}|${whenKey}`);
        else if (dim.dimension === "channel" && key !== "ga4_users") {
          const k = `${key}|${whenKey}`;
          channelSums.set(k, (channelSums.get(k) ?? 0) + value);
        }
      }
    }
  }

  // Channels are exhaustive, so they add up to the site total. Use that when
  // the file did not include a total row of its own.
  let derived = 0;
  for (const [k, value] of channelSums) {
    if (explicitTotals.has(k)) continue;
    const [key, a, b] = k.split("|");
    out.value("ga4", key, b ? { start: a, end: b } : { date: a }, value);
    derived++;
  }
  if (derived) out.warn("Site totals were calculated by adding up all channels.");
}
