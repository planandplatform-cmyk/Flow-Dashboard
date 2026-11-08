/**
 * Google Search Console exports (Performance > Export > Download CSV or
 * Download Excel). The CSV download is a ZIP of files and the Excel download
 * one workbook, both holding the same tables:
 *
 * - Dates (named Chart.csv in some downloads): Date, Clicks, Impressions,
 *   CTR, Position. Daily site totals.
 * - Queries ("Top queries"), Pages ("Top pages"), Countries and Devices:
 *   totals for the export's date range, by search term, page, country or
 *   device.
 * - Search appearance: rich result types (review snippets, FAQ, videos...).
 *   Often empty for smaller sites, which is fine.
 * - Filters: read for the date range ("Oct 1, 2026-Oct 31, 2026").
 *
 * Position is stored as position x impressions so it averages correctly over
 * any range; CTR is recomputed from clicks and impressions.
 */
import { pagePath } from "@/lib/connectors/gsc-map";
import { norm, num, parseDate } from "../cells";
import type { ParseContext, Parser, Period, Sheet } from "../types";
import { fileNamePeriod, missingPeriodMessage } from "./common";

type Kind = "dates" | "queries" | "pages" | "countries" | "devices" | "appearance" | "unused" | "filters";

const FIRST: Record<string, Kind> = {
  date: "dates",
  "top queries": "queries",
  query: "queries",
  queries: "queries",
  "top pages": "pages",
  page: "pages",
  pages: "pages",
  country: "countries",
  countries: "countries",
  device: "devices",
  devices: "devices",
  "search appearance": "appearance",
  filter: "filters",
};

/** The header row and what kind of table this sheet is. */
function classify(sheet: Sheet): { kind: Kind; header: number } | null {
  for (let h = 0; h < Math.min(sheet.rows.length, 5); h++) {
    const row = sheet.rows[h].map(norm);
    const kind = FIRST[row[0] ?? ""];
    if (!kind) continue;
    if (kind === "filters" && row[1] === "value") return { kind, header: h };
    if (row.includes("clicks") && row.includes("impressions")) return { kind, header: h };
  }
  return null;
}

/** A compare-mode export has columns like "Last 28 days Clicks" instead of "Clicks". */
const isComparison = (sheet: Sheet, header: number) => sheet.rows[header].some((c) => /\bclicks$/i.test(c) && norm(c) !== "clicks");

/** The date range from the Filters table, when it is written as dates ("Oct 1, 2026-Oct 31, 2026"). */
export function filtersPeriod(sheet: Sheet, header: number): Period | null {
  for (const row of sheet.rows.slice(header + 1)) {
    if (norm(row[0]) !== "date") continue;
    const text = (row[1] ?? "").replace(/^[^:\d]*:\s*/, "");
    const m =
      /([A-Za-z]{3,9}\.? \d{1,2}, \d{4})\s*(?:[-–—]|to)\s*([A-Za-z]{3,9}\.? \d{1,2}, \d{4})/.exec(text) ??
      /(\d{4}-\d{2}-\d{2})\s*(?:[-–—]|to)\s*(\d{4}-\d{2}-\d{2})/.exec(text) ??
      /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*(?:[-–—]|to)\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/.exec(text);
    if (!m) return null;
    const start = parseDate(m[1]);
    const end = parseDate(m[2]);
    return start && end && end >= start ? { start, end } : null;
  }
  return null;
}

const DIMENSION: Partial<Record<Kind, string>> = { queries: "query", pages: "page", countries: "country", devices: "device", appearance: "appearance" };

export const searchConsoleParser: Parser = {
  id: "search_console",
  label: "Google Search Console export",
  sources: ["search_console"],

  detect(sheets) {
    let best = 0;
    for (const s of sheets) {
      const c = classify(s);
      if (!c) continue;
      const row = s.rows[c.header].map(norm);
      // Position and no Cost tell it apart from Google Ads tables.
      if (c.kind === "filters") best = Math.max(best, 0.5);
      else if (row.includes("position") && !row.includes("cost")) best = Math.max(best, 0.96);
    }
    return best;
  },

  parse(sheets, ctx: ParseContext, out) {
    const tables = sheets.map((s) => ({ sheet: s, c: classify(s) })).filter((t): t is { sheet: Sheet; c: NonNullable<ReturnType<typeof classify>> } => t.c !== null);
    if (tables.some((t) => t.c.kind !== "filters" && isComparison(t.sheet, t.c.header))) {
      out.error("This export compares two date ranges. In Search Console, pick a single date range (no Compare), then export again.");
      return;
    }

    // Daily totals first: they also give the date range for the other tables.
    const days: string[] = [];
    for (const { sheet, c } of tables.filter((t) => t.c.kind === "dates")) {
      const head = sheet.rows[c.header].map(norm);
      const col = (name: string) => head.indexOf(name);
      for (const row of sheet.rows.slice(c.header + 1)) {
        const date = parseDate(row[0], ctx.today);
        if (!date) continue;
        const clicks = num(row[col("clicks")]);
        const impressions = num(row[col("impressions")]);
        const position = num(row[col("position")]);
        out.rowsRead++;
        if (clicks !== null) out.daily("search_console", "gsc_clicks", date, clicks);
        if (impressions !== null) out.daily("search_console", "gsc_impressions", date, impressions);
        if (position !== null && impressions !== null) out.daily("search_console", "gsc_position_weighted", date, Math.round(position * impressions * 100) / 100);
        days.push(date);
      }
    }

    days.sort();
    const datesPeriod: Period | null = days.length ? { start: days[0], end: days[days.length - 1] } : null;
    const filters = tables.find((t) => t.c.kind === "filters");
    const period = datesPeriod ?? (filters ? filtersPeriod(filters.sheet, filters.c.header) : null) ?? fileNamePeriod(ctx.fileName) ?? ctx.period ?? null;

    for (const { sheet, c } of tables.filter((t) => DIMENSION[t.c.kind])) {
      if (!period) {
        out.error(missingPeriodMessage("Search Console"));
        return;
      }
      const dimension = DIMENSION[c.kind]!;
      const head = sheet.rows[c.header].map(norm);
      const col = (name: string) => head.indexOf(name);
      // Search Console lists up to 1,000 rows; the top ones by clicks are what the report shows.
      for (const row of sheet.rows.slice(c.header + 1, c.header + 1 + 250)) {
        // Long questions wrap onto a second line inside the CSV; show them on one.
        const label = (row[0] ?? "").replace(/\s+/g, " ").trim();
        if (!label) continue;
        const value = (dimension === "page" ? pagePath(label) : label).slice(0, 200);
        const clicks = num(row[col("clicks")]);
        const impressions = num(row[col("impressions")]);
        const position = num(row[col("position")]);
        out.rowsRead++;
        if (clicks !== null) out.period("search_console", "gsc_clicks", period.start, period.end, clicks, dimension, value);
        if (impressions !== null) out.period("search_console", "gsc_impressions", period.start, period.end, impressions, dimension, value);
        if (position !== null && impressions !== null) {
          out.period("search_console", "gsc_position_weighted", period.start, period.end, Math.round(position * impressions * 100) / 100, dimension, value);
        }
      }
    }

    const used = tables.some((t) => t.c.kind === "dates" || DIMENSION[t.c.kind]);
    if (!used) {
      out.error(
        tables.some((t) => t.c.kind === "filters")
          ? "Filters.csv only describes the export (its dates are read when you upload the whole export). Upload Chart.csv or Dates.csv, Queries, Pages, Countries, Devices and Search appearance, or the whole ZIP or Excel download."
          : "This Search Console file is not one the report uses. Upload Chart.csv or Dates.csv, Queries, Pages, Countries, Devices and Search appearance (or the whole ZIP or Excel download from Performance > Export).",
      );
      return;
    }
    if (out.rowsRead === 0 && tables.some((t) => t.c.kind === "appearance")) {
      out.error(
        "Nothing to save from this file: Search Console had no search appearance results for this period, which is normal for most smaller sites. Upload the other files from the export.",
      );
      return;
    }
    if (!tables.some((t) => t.c.kind === "dates")) {
      out.warn("No Chart or Dates file was included, so site totals (clicks, impressions, average position) were not saved. Upload Chart.csv (or Dates.csv) as well, or the whole export.");
    }
  },
};
