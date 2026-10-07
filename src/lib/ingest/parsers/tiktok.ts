/**
 * TikTok analytics downloads (TikTok Studio > Analytics > Download data, or
 * the Business Suite equivalent). The download is a set of CSV/XLSX files;
 * each can be uploaded on its own:
 *
 *   Overview         Date, Video Views, Profile Views, Likes, Comments, Shares
 *   FollowerHistory  Date, Followers, Difference in followers from previous day
 *   Content          Video title, Video link, Post time, Total likes, ...
 *   Gender / Territories / Activity  share distributions
 *
 * TikTok dates often omit the year ("July 1"); the year is inferred from the
 * period entered on the upload form, or today's date.
 */
import { norm, num, parseDate, parseTimestamp, rate, summarize } from "../cells";
import type { BatchBuilder } from "../batch";
import type { ParseContext, Parser, Sheet } from "../types";
import { cell, headerSet, hasAny, mapHeaders, yearHint } from "./common";

const OVERVIEW = {
  date: ["Date"],
  views: ["Video Views", "Video views", "Views", "Post views"],
  profileViews: ["Profile Views", "Profile views"],
  likes: ["Likes"],
  comments: ["Comments"],
  shares: ["Shares"],
  followers: ["Followers", "Total followers"],
  netFollowers: ["Difference in followers from previous day", "Net followers", "New followers", "Follower growth"],
};
const CONTENT = {
  title: ["Video title", "Title", "Description"],
  link: ["Video link", "Link"],
  posted: ["Post time", "Posted", "Create time", "Date posted"],
  likes: ["Total likes", "Likes"],
  comments: ["Total comments", "Comments"],
  shares: ["Total shares", "Shares"],
  views: ["Total views", "Video views", "Views"],
  saves: ["Total saves", "Saves", "Favorites"],
};
const IGNORE = ["Time", "Engagements", "Unique viewers", "Reached audience", "Average watch time*", "Total play time*", "Watched full video*", "Live*"];

export const tiktokParser: Parser = {
  id: "tiktok_analytics",
  label: "TikTok analytics download",
  sources: ["tiktok"],

  detect(sheets, ctx) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 3);
      if (hasAny(h, "Video Views", "Profile Views") && hasAny(h, "Date")) return 0.9;
      if (hasAny(h, "Difference in followers from previous day")) return 0.95;
      if (hasAny(h, "Video link") && hasAny(h, "Post time", "Total views")) return 0.95;
      if (ctx.source === "tiktok" && hasAny(h, "Distribution")) return 0.8;
    }
    return 0;
  },

  parse(sheets, ctx, out) {
    for (const sheet of sheets) {
      const h = headerSet(sheet.rows, 3);
      if (hasAny(h, "Video link", "Post time", "Total views")) parseContent(sheet, ctx, out);
      else if (hasAny(h, "Distribution")) parseDistribution(sheet, ctx, out);
      else parseOverview(sheet, ctx, out);
    }
  },
};

function headerRow(sheet: Sheet, names: string[]): number {
  const set = new Set(names.map(norm));
  return sheet.rows.findIndex((r, i) => i < 5 && r.some((c) => set.has(norm(c))));
}

function parseOverview(sheet: Sheet, ctx: ParseContext, out: BatchBuilder) {
  const h = headerRow(sheet, ["Date"]);
  if (h < 0) return;
  const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], OVERVIEW, IGNORE);
  out.columns(mapped, unmapped);
  for (const row of sheet.rows.slice(h + 1)) {
    const date = parseDate(cell(row, idx.date), yearHint(ctx));
    if (!date) continue;
    out.rowsRead++;
    out.daily("tiktok", "tt_views", date, num(cell(row, idx.views)));
    out.daily("tiktok", "tt_profile_views", date, num(cell(row, idx.profileViews)));
    const parts = [idx.likes, idx.comments, idx.shares].map((i) => num(cell(row, i))).filter((v): v is number => v !== null);
    if (parts.length) out.daily("tiktok", "tt_interactions", date, parts.reduce((a, b) => a + b, 0));
    out.daily("tiktok", "tt_followers", date, num(cell(row, idx.followers)));
    out.daily("tiktok", "tt_net_new_followers", date, num(cell(row, idx.netFollowers)));
  }
  if (idx.likes >= 0 && (idx.comments < 0 || idx.shares < 0)) {
    out.warn("Interactions only include the likes, comments and shares columns present in the file.");
  }
}

function parseContent(sheet: Sheet, ctx: ParseContext, out: BatchBuilder) {
  const h = headerRow(sheet, ["Video link", "Post time", "Video title"]);
  if (h < 0) return;
  const { idx, mapped, unmapped } = mapHeaders(sheet.rows[h], CONTENT, IGNORE);
  out.columns(mapped, unmapped);
  for (const row of sheet.rows.slice(h + 1)) {
    const link = cell(row, idx.link);
    const title = cell(row, idx.title) || null;
    const id = link?.match(/video\/(\d+)/)?.[1] ?? link ?? title;
    const posted = parseTimestamp(cell(row, idx.posted), yearHint(ctx));
    if (!id || !posted) continue;
    out.rowsRead++;
    const likes = num(cell(row, idx.likes));
    const comments = num(cell(row, idx.comments));
    const shares = num(cell(row, idx.shares));
    const saves = num(cell(row, idx.saves));
    const parts = [likes, comments, shares].filter((v): v is number => v !== null);
    out.post({
      platform: "tiktok",
      external_id: id,
      published_at: posted,
      format: "video",
      caption: title,
      summary: summarize(title) ?? "TikTok video",
      permalink: link || null,
      views: num(cell(row, idx.views)),
      reach: null,
      interactions: parts.length ? parts.reduce((a, b) => a + b, 0) : null,
      likes,
      comments,
      saves,
      shares,
    });
  }
}

/** Gender, Top territories, etc: a label column plus a Distribution column. */
function parseDistribution(sheet: Sheet, ctx: ParseContext, out: BatchBuilder) {
  const h = headerRow(sheet, ["Distribution"]);
  if (h < 0) return;
  const headers = sheet.rows[h];
  const distIdx = headers.findIndex((c) => norm(c) === "distribution");
  const labelIdx = distIdx === 0 ? 1 : 0;
  const label = norm(headers[labelIdx] ?? "");
  const type = label.includes("gender")
    ? "gender"
    : label.includes("territor") || label.includes("country") || label.includes("location")
      ? "country"
      : label.includes("age")
        ? "age"
        : label.includes("language")
          ? "language"
          : null;
  if (!type) {
    out.columns([], [headers[labelIdx]]);
    out.warn(`Skipped the "${headers[labelIdx]}" breakdown; it is not shown in the portal.`);
    return;
  }
  out.columns([headers[labelIdx], headers[distIdx]], []);
  const snapshotDate = ctx.period?.end ?? ctx.today;
  for (const row of sheet.rows.slice(h + 1)) {
    const bucket = row[labelIdx];
    const share = rate(row[distIdx]);
    if (!bucket || share === null) continue;
    out.rowsRead++;
    out.snapshot({ platform: "tiktok", snapshot_date: snapshotDate, period_start: null, breakdown_type: type, bucket, share });
  }
  if (!ctx.period) out.warn(`Audience breakdown dated ${snapshotDate} (today). Enter a period to date it to the report month.`);
}
