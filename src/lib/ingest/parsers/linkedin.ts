/**
 * LinkedIn company page analytics exports (Page admin > Analytics > Export).
 * Each export is an .xls/.xlsx workbook with several sheets, usually a note
 * on the first row and the header on the second:
 *
 *   Content (updates)  "Metrics" sheet: Date, Impressions (organic), Clicks
 *                      (organic), Reactions (organic), Comments (organic),
 *                      Reposts (organic)...; "All posts" sheet: one row per post
 *   Followers          "New followers" sheet: Date, ..., Total followers (new
 *                      per day); demographic sheets (Location, Job function...)
 *   Visitors           "Visitor metrics" sheet: Date, ..., Total page views (total)
 *
 * Organic columns are preferred because the portal reports organic page
 * performance. LinkedIn exports do not include unfollows or the running
 * follower total; enter the total with the manual form.
 */
import { norm, num, parseDate, parseTimestamp, summarize } from "../cells";
import type { BatchBuilder } from "../batch";
import type { BreakdownType, ParseContext, Parser, PostIn, Sheet } from "../types";
import { cell, mapHeaders, yearHint } from "./common";

const METRICS_ROLES = {
  date: ["Date"],
  impressions: ["Impressions (organic)", "Impressions (total)", "Impressions"],
  clicks: ["Clicks (organic)", "Clicks (total)", "Clicks"],
  reactions: ["Reactions (organic)", "Reactions (total)", "Reactions"],
  comments: ["Comments (organic)", "Comments (total)", "Comments"],
  reposts: ["Reposts (organic)", "Reposts (total)", "Reposts", "Shares (organic)", "Shares"],
};
const FOLLOWER_ROLES = { date: ["Date"], newFollowers: ["Total followers", "Total new followers"] };
const VISITOR_ROLES = { date: ["Date"], pageViews: ["Total page views (total)", "Total page views", "Page views (total)"] };
const POST_ROLES = {
  title: ["Post title", "Update title", "Title"],
  link: ["Post link", "Update link", "Link"],
  type: ["Content Type", "Post type", "Update type"],
  created: ["Created date", "Date", "Posted on"],
  impressions: ["Impressions"],
  views: ["Views (excluding off-site video views)", "Views", "Video views"],
  clicks: ["Clicks"],
  likes: ["Likes", "Reactions"],
  comments: ["Comments"],
  reposts: ["Reposts", "Shares"],
};
const IGNORE = [
  "*(sponsored)", "Unique impressions*", "Engagement rate*", "Click through rate*", "Campaign*", "Audience", "Posted by",
  "Off-site views", "Follows", "Sponsored followers", "Organic followers", "Auto-invited followers", "*(desktop)", "*(mobile)",
  "Total unique visitors*", "*page views (total)", "*unique visitors (total)",
];

const DEMOGRAPHIC_SHEETS: { match: RegExp; type: BreakdownType }[] = [
  { match: /^location/i, type: "city" },
  { match: /^country/i, type: "country" },
  { match: /^job function/i, type: "job_function" },
  { match: /^seniority/i, type: "seniority" },
  { match: /^industry/i, type: "industry" },
  { match: /^company size/i, type: "company_size" },
];

function headerIndex(sheet: Sheet, names: string[]): number {
  const set = new Set(names.map(norm));
  return sheet.rows.findIndex((r, i) => i < 6 && r.some((c) => set.has(norm(c))));
}

export const linkedinParser: Parser = {
  id: "linkedin_page",
  label: "LinkedIn page analytics export",
  sources: ["linkedin"],

  detect(sheets, ctx) {
    const names = sheets.map((s) => norm(s.name));
    if (names.some((n) => ["metrics", "all posts", "new followers", "visitor metrics"].includes(n))) return 0.95;
    for (const s of sheets) {
      const head = s.rows.slice(0, 4).flat().map(norm);
      if (head.some((c) => c.endsWith("(organic)"))) return 0.9;
    }
    return ctx.source === "linkedin" ? 0.3 : 0;
  },

  parse(sheets, ctx, out) {
    for (const sheet of sheets) {
      const name = norm(sheet.name);
      const demo = DEMOGRAPHIC_SHEETS.find((d) => d.match.test(sheet.name));
      if (name === "all posts" || headerIndex(sheet, ["Post link", "Update link"]) >= 0) parsePosts(sheet, ctx, out);
      else if (demo) parseDemographic(sheet, demo.type, ctx, out);
      else if (headerIndex(sheet, ["Total page views (total)", "Total page views"]) >= 0) parseDaily(sheet, VISITOR_ROLES, ctx, out);
      else if (name === "new followers" || headerIndex(sheet, ["Organic followers", "Sponsored followers"]) >= 0) parseDaily(sheet, FOLLOWER_ROLES, ctx, out);
      else if (headerIndex(sheet, ["Impressions (organic)", "Impressions (total)", "Impressions"]) >= 0) parseDaily(sheet, METRICS_ROLES, ctx, out);
    }
    out.warn("LinkedIn exports do not include your running follower total or unfollows. Add the follower total with the manual form.");
  },
};

function parseDaily(sheet: Sheet, roles: Record<string, string[]>, ctx: ParseContext, out: BatchBuilder) {
  const h = headerIndex(sheet, ["Date"]);
  if (h < 0) return;
  const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], roles, IGNORE);
  out.columns(mapped, unmapped);
  const v = (row: string[], role: string) => num(cell(row, (idx as Record<string, number>)[role] ?? -1));
  for (const row of sheet.rows.slice(h + 1)) {
    const date = parseDate(cell(row, idx.date), yearHint(ctx));
    if (!date) continue;
    out.rowsRead++;
    if ("impressions" in roles) {
      out.daily("linkedin", "li_impressions", date, v(row, "impressions"));
      const parts = ["clicks", "reactions", "comments", "reposts"].map((r) => v(row, r)).filter((x): x is number => x !== null);
      if (parts.length) out.daily("linkedin", "li_interactions", date, parts.reduce((a, b) => a + b, 0));
    }
    if ("newFollowers" in roles) out.daily("linkedin", "li_net_new_followers", date, v(row, "newFollowers"));
    if ("pageViews" in roles) out.daily("linkedin", "li_page_views", date, v(row, "pageViews"));
  }
}

function postFormat(raw: string | undefined): PostIn["format"] {
  const t = norm(raw ?? "");
  if (t.includes("video")) return "video";
  if (t.includes("image") || t.includes("photo")) return "photo";
  if (t.includes("carousel") || t.includes("document")) return "carousel";
  if (t.includes("article") || t.includes("link")) return "link";
  if (t.includes("text")) return "text";
  return "other";
}

function parsePosts(sheet: Sheet, ctx: ParseContext, out: BatchBuilder) {
  const h = headerIndex(sheet, ["Post link", "Update link", "Post title"]);
  if (h < 0) return;
  const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], POST_ROLES, IGNORE);
  out.columns(mapped, unmapped);
  for (const row of sheet.rows.slice(h + 1)) {
    const link = cell(row, idx.link);
    const title = cell(row, idx.title) || null;
    const id = link?.match(/urn:li:[a-zA-Z]+:\d+/)?.[0] ?? link;
    const created = parseTimestamp(cell(row, idx.created), yearHint(ctx));
    if (!id || !created) continue;
    out.rowsRead++;
    const likes = num(cell(row, idx.likes));
    const comments = num(cell(row, idx.comments));
    const reposts = num(cell(row, idx.reposts));
    const clicks = num(cell(row, idx.clicks));
    const parts = [likes, comments, reposts, clicks].filter((v): v is number => v !== null);
    out.post({
      platform: "linkedin",
      external_id: id,
      published_at: created,
      format: postFormat(cell(row, idx.type)),
      caption: title,
      summary: summarize(title) ?? "LinkedIn post",
      permalink: link || null,
      views: num(cell(row, idx.impressions)) ?? num(cell(row, idx.views)),
      reach: null,
      interactions: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
      likes,
      comments,
      saves: null,
      shares: reposts,
    });
  }
}

/** Demographic sheets list counts; convert them to shares of the sheet total. */
function parseDemographic(sheet: Sheet, type: BreakdownType, ctx: ParseContext, out: BatchBuilder) {
  const h = sheet.rows.findIndex((r, i) => i < 6 && r.length >= 2 && r[0] && /follower|visitor|count/i.test(r.slice(1).join(" ")));
  if (h < 0) return;
  const headers = sheet.rows[h];
  out.columns([headers[0], headers[1]], headers.slice(2).filter(Boolean));
  const rows = sheet.rows
    .slice(h + 1)
    .map((r) => ({ bucket: r[0], count: num(r[1]) }))
    .filter((r): r is { bucket: string; count: number } => Boolean(r.bucket) && r.count !== null);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (!total) return;
  const snapshotDate = ctx.period?.end ?? ctx.today;
  for (const r of rows.sort((a, b) => b.count - a.count).slice(0, 25)) {
    out.rowsRead++;
    out.snapshot({ platform: "linkedin", snapshot_date: snapshotDate, period_start: null, breakdown_type: type, bucket: r.bucket, share: r.count / total });
  }
}
