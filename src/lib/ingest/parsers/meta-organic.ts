/**
 * Meta Business Suite exports for Facebook Pages and Instagram accounts.
 *
 * 1. Insights time series (Insights > Overview/Results > Export): one metric
 *    per file, shaped as an optional "sep=," line, a title line naming the
 *    metric (e.g. "Views" or "Facebook Page views"), then "Date,Primary" and
 *    one row per day. Wide variants (Date plus one column per metric) are
 *    also accepted.
 * 2. Content export (Insights > Content > Export): one row per post with
 *    lifetime metrics.
 *
 * Meta renamed several metrics in 2025 (impressions became views on most
 * surfaces), so older names are accepted as aliases.
 */
import { norm, num, parseDate, parseTimestamp, summarize } from "../cells";
import type { ParseContext, Parser, PostIn, Sheet } from "../types";
import type { DataSource } from "@/lib/metrics/types";
import { cell, headerSet, hasAll, hasAny, mapHeaders, yearHint } from "./common";

type Platform = "meta_facebook" | "meta_instagram";

/** Metric title (normalized) -> metric suffix per platform. */
const TITLE_MAP: { names: string[]; fb?: string; ig?: string }[] = [
  { names: ["views", "impressions", "page views", "facebook views", "instagram views", "content views"], fb: "fb_views", ig: "ig_views" },
  { names: ["reach", "accounts reached", "facebook reach", "instagram reach", "page reach"], fb: "fb_reach", ig: "ig_reach" },
  {
    names: ["content interactions", "interactions", "engagements", "post engagements", "engagement", "facebook content interactions", "instagram content interactions"],
    fb: "fb_interactions",
    ig: "ig_interactions",
  },
  {
    names: ["visits", "page visits", "facebook visits", "facebook page visits", "profile visits", "instagram profile visits", "profile views"],
    fb: "fb_page_visits",
    ig: "ig_profile_visits",
  },
  { names: ["follows", "new follows", "new followers", "net follows", "net followers", "facebook follows", "instagram follows"], fb: "fb_net_new_followers", ig: "ig_net_new_followers" },
  { names: ["followers", "total followers", "page followers", "facebook followers", "instagram followers", "follower count"], fb: "fb_followers", ig: "ig_followers" },
  { names: ["reactions", "post reactions"], fb: "fb_reactions" },
];
const UNFOLLOWS = ["unfollows", "page unfollows"];

function metricFor(title: string, platform: Platform): string | null {
  const t = norm(title)
    .replace(/^(facebook|instagram|fb|ig)\s+/, "")
    .replace(/\s*\(.*\)$/, "");
  for (const m of TITLE_MAP) {
    if (m.names.includes(t) || m.names.includes(norm(title))) return (platform === "meta_facebook" ? m.fb : m.ig) ?? null;
  }
  return null;
}

/** Which platform a file is for: the admin's choice wins, then the file itself. */
function platformOf(sheets: Sheet[], ctx: ParseContext): Platform | null {
  if (ctx.source === "meta_facebook" || ctx.source === "meta_instagram") return ctx.source;
  const text = `${ctx.fileName} ${sheets.flatMap((s) => s.rows.slice(0, 5).flat()).join(" ")}`.toLowerCase();
  const ig = /instagram|\big\b|account username/.test(text);
  const fb = /facebook|\bfb\b|page id|page name/.test(text);
  if (ig && !fb) return "meta_instagram";
  if (fb && !ig) return "meta_facebook";
  return null;
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

function findDateHeader(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 8); i++) if (norm(rows[i][0] ?? "") === "date") return i;
  return -1;
}

export const metaInsightsParser: Parser = {
  id: "meta_insights",
  label: "Meta Business Suite insights export",
  sources: ["meta_facebook", "meta_instagram"],

  detect(sheets, ctx) {
    for (const s of sheets) {
      const h = findDateHeader(s.rows);
      if (h < 0) continue;
      const headers = s.rows[h].slice(1).map(norm);
      const titled = headers.includes("primary") || headers.includes("value");
      const known = headers.some((x) => metricFor(x, "meta_facebook") || metricFor(x, "meta_instagram"));
      if (titled || known) return ctx.source === "meta_facebook" || ctx.source === "meta_instagram" ? 0.9 : 0.75;
    }
    return 0;
  },

  parse(sheets, ctx, out) {
    const platform = platformOf(sheets, ctx);
    if (!platform) {
      out.error("Could not tell whether this is a Facebook or an Instagram export. Choose the platform and preview again.");
      return;
    }
    for (const sheet of sheets) {
      const h = findDateHeader(sheet.rows);
      if (h < 0) continue;
      const headers = sheet.rows[h];
      // The metric name is the title line above the header, or the file name.
      const title = h > 0 ? sheet.rows[h - 1].find((c) => c) ?? "" : "";
      const columns = headers.slice(1).map((name, j) => {
        const n = norm(name);
        const generic = n === "primary" || n === "value" || n === "";
        const label = generic ? title || ctx.fileName.replace(/\.[^.]+$/, "") : name;
        return { idx: j + 1, name, label, key: metricFor(label, platform), unfollows: UNFOLLOWS.includes(norm(label)), generic };
      });
      const mapped = columns.filter((c) => c.key || c.unfollows);
      if (!mapped.length) {
        out.error(
          `Did not recognize the metric "${columns[0]?.label ?? title}". Supported: views, reach, content interactions, visits, follows, followers${platform === "meta_facebook" ? ", reactions" : ""}.`,
        );
        continue;
      }
      out.columns(
        [headers[0], ...mapped.map((c) => (c.generic ? `${c.name} (${c.label})` : c.name))],
        columns.filter((c) => !c.key && !c.unfollows).map((c) => c.label),
      );
      // "Comparison" columns (previous period) are never taken.
      const unfollowCol = columns.find((c) => c.unfollows);
      const followsKey = platform === "meta_facebook" ? "fb_net_new_followers" : "ig_net_new_followers";
      if (mapped.some((c) => c.key === followsKey) && !unfollowCol) {
        out.warn("Follows are new follows only; unfollows were not in the file, so net growth may be overstated.");
      }

      for (const row of sheet.rows.slice(h + 1)) {
        const date = parseDate(row[0], yearHint(ctx));
        if (!date) continue;
        out.rowsRead++;
        for (const c of mapped) {
          if (!c.key) continue;
          let v = num(row[c.idx]);
          if (v !== null && c.key === followsKey && unfollowCol) v -= num(row[unfollowCol.idx]) ?? 0;
          out.daily(platform, c.key, date, v);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// Content (posts)
// ---------------------------------------------------------------------------

const CONTENT_ROLES = {
  id: ["Post ID", "Media ID", "ID"],
  published: ["Publish time", "Published", "Created", "Date published"],
  caption: ["Description", "Caption", "Message", "Post message"],
  title: ["Title"],
  permalink: ["Permalink", "Post link", "Link"],
  type: ["Post type", "Media type", "Type"],
  views: ["Views", "Plays", "Impressions"],
  reach: ["Reach", "Accounts reached"],
  reactions: ["Reactions", "Likes"],
  comments: ["Comments"],
  shares: ["Shares"],
  saves: ["Saves", "Saved"],
  interactionsTotal: ["Reactions, comments and shares", "Interactions", "Total interactions", "Engagements"],
};
const CONTENT_IGNORE = [
  "Page ID", "Page name", "Account ID", "Account username", "Account name", "Duration (sec)", "Is crosspost", "Is share",
  "Languages", "Custom labels", "Funded content status", "Data comment", "Date", "Caption type", "Follows", "Total clicks",
  "Link clicks", "Other clicks", "Profile visits", "Negative feedback*", "Matched audience*", "Seconds viewed",
  "Average seconds viewed", "Estimated earnings*", "Ad impressions", "Ad CPM*", "Replies", "Navigation", "Sticker taps",
  "Profile activity", "Exits", "Forward taps", "Back taps", "Next story",
];

function formatOf(raw: string | undefined): PostIn["format"] {
  const t = norm(raw ?? "");
  if (/reel/.test(t)) return "reel";
  if (/carousel|album/.test(t)) return "carousel";
  if (/stor/.test(t)) return "story";
  if (/video|live/.test(t)) return "video";
  if (/photo|image/.test(t)) return "photo";
  if (/link/.test(t)) return "link";
  if (/text|status/.test(t)) return "text";
  return "other";
}

export const metaContentParser: Parser = {
  id: "meta_content",
  label: "Meta Business Suite content export",
  sources: ["meta_facebook", "meta_instagram"],

  detect(sheets) {
    for (const s of sheets) {
      const h = headerSet(s.rows, 5);
      if (hasAny(h, "Permalink") && hasAny(h, "Post ID", "Publish time") && !hasAny(h, "Video link")) return 0.95;
    }
    return 0;
  },

  parse(sheets, ctx, out) {
    for (const sheet of sheets) {
      const h = sheet.rows.findIndex((r) => r.some((c) => norm(c) === "permalink"));
      if (h < 0) continue;
      const headers = sheet.rows[h];
      const hs = new Set(headers.map(norm));
      let platform = platformOf(sheets, ctx);
      if (hasAll(hs, "Account username")) platform = "meta_instagram";
      else if (hasAny(hs, "Page ID", "Page name")) platform = "meta_facebook";
      if (!platform) {
        out.error("Could not tell whether this is a Facebook or an Instagram export. Choose the platform and preview again.");
        return;
      }
      if (ctx.source && ctx.source !== platform && (ctx.source === "meta_facebook" || ctx.source === "meta_instagram")) {
        out.warn(`This looks like a ${platform === "meta_instagram" ? "Instagram" : "Facebook"} export; using that instead of your choice.`);
      }
      const { idx, mapped, unmapped } = mapHeaders(headers, CONTENT_ROLES, CONTENT_IGNORE);
      out.columns(mapped, unmapped);
      if (idx.id < 0 && idx.permalink < 0) {
        out.error("The content export needs a Post ID or Permalink column.");
        return;
      }

      for (const row of sheet.rows.slice(h + 1)) {
        const externalId = cell(row, idx.id) || cell(row, idx.permalink);
        if (!externalId) continue;
        const published = parseTimestamp(cell(row, idx.published), yearHint(ctx));
        if (!published) {
          out.warn(`Skipped post ${externalId}: unreadable publish time.`);
          continue;
        }
        out.rowsRead++;
        const reactions = num(cell(row, idx.reactions));
        const comments = num(cell(row, idx.comments));
        const shares = num(cell(row, idx.shares));
        const saves = num(cell(row, idx.saves));
        const parts = [reactions, comments, shares, saves].filter((v): v is number => v !== null);
        const caption = cell(row, idx.caption) || cell(row, idx.title) || null;
        out.post({
          platform: platform as DataSource,
          external_id: externalId,
          published_at: published,
          format: formatOf(cell(row, idx.type)),
          caption,
          summary: summarize(caption) ?? `${formatOf(cell(row, idx.type))} post`,
          permalink: cell(row, idx.permalink) || null,
          views: num(cell(row, idx.views)),
          reach: num(cell(row, idx.reach)),
          interactions: num(cell(row, idx.interactionsTotal)) ?? (parts.length ? parts.reduce((a, b) => a + b, 0) : null),
          likes: reactions,
          comments,
          saves,
          shares,
        });
      }
    }
  },
};
