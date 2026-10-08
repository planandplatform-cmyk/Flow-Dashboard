"use server";

import { refresh } from "next/cache";
import { cleanCopy } from "@/lib/commentary/copy";
import { auditAction, authorizeStaffForClient } from "@/lib/data/authorize";
import { getViewer } from "@/lib/data/portal";
import { monthRange } from "@/lib/dates";
import { readPeriod } from "@/lib/ingest/manual";
import { reportPlatforms, reviewReport, splitReport, type ReportReview, type ReviewedReport } from "@/lib/ingest/report-import";
import {
  buildScreenshotResult,
  COMPETITOR_METRICS,
  SCREENSHOT_BREAKDOWNS,
  SCREENSHOT_PLATFORMS,
  type ScreenshotPlatform,
} from "@/lib/ingest/screenshot";
import { readReport, screenshotReadingConfigured, ScreenshotReadError } from "@/lib/ingest/screenshot-reader";
import { resolveFiles } from "@/lib/ingest/staged-server";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * A complete past report, read once by Claude and reviewed on screen. Save
 * stores the file once and one upload per platform, so each platform's
 * numbers show in history and can be rolled back separately.
 */

export type ReportReadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | ({ status: "ready"; platforms: ScreenshotPlatform[]; demo: boolean; hasCommentary: boolean } & ReportReview);

export async function readReportUpload(slug: string, _prev: ReportReadState, form: FormData): Promise<ReportReadState> {
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!screenshotReadingConfigured()) return { status: "error", message: "Reading reports needs an Anthropic API key. Add ANTHROPIC_API_KEY to the environment variables." };
  const platforms = reportPlatforms(auth.client.enabled_sources);
  if (!platforms.length) return { status: "error", message: `${auth.client.name} has no website, Facebook, Instagram, Meta Ads or LinkedIn channel turned on.` };
  const entered = readPeriod(form);
  if (entered === "invalid") return { status: "error", message: "Enter a valid start and end date." };
  const f = await resolveFiles(form, auth.client.id, 1);
  if ("error" in f) return { status: "error", message: f.error };

  let extraction;
  try {
    extraction = await readReport(f.images[0], platforms, new Date().toISOString().slice(0, 10));
  } catch (e) {
    return { status: "error", message: e instanceof ScreenshotReadError ? e.message : "Something went wrong reading the report." };
  }
  const review = reviewReport(extraction, platforms, entered);
  const hasCommentary = Boolean(review.commentary && (review.commentary.headline || review.commentary.summary || review.commentary.conclusion));
  return { status: "ready", platforms, demo: isDemoMode(), hasCommentary, ...review };
}

const isPlatform = (v: unknown): v is ScreenshotPlatform => (SCREENSHOT_PLATFORMS as readonly string[]).includes(String(v));
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.slice(0, max) : null);

function parseReviewed(raw: string): ReviewedReport | null {
  try {
    const v = JSON.parse(raw) as ReviewedReport;
    if (typeof v.period?.start !== "string" || typeof v.period?.end !== "string") return null;
    return {
      period: { start: v.period.start, end: v.period.end },
      metrics: (v.metrics ?? []).filter((m) => isPlatform(m.source)).map((m) => ({ source: m.source, key: String(m.key), value: Number(m.value) })),
      tableRows: (v.tableRows ?? []).map((t) => ({ key: String(t.key), dimension: String(t.dimension), bucket: String(t.bucket).slice(0, 200), value: Number(t.value) })),
      breakdowns: (v.breakdowns ?? [])
        .filter((b) => isPlatform(b.platform) && SCREENSHOT_BREAKDOWNS.includes(b.type))
        .map((b) => ({ platform: b.platform, type: b.type, bucket: String(b.bucket).slice(0, 120), percent: Number(b.percent) })),
      competitors: (v.competitors ?? [])
        .filter((c) => (COMPETITOR_METRICS as readonly string[]).includes(c.metric))
        .map((c) => ({ company: String(c.company).slice(0, 120), own: Boolean(c.own), metric: c.metric, value: Number(c.value), change: c.change === null ? null : Number(c.change) })),
      commentary: v.commentary
        ? { headline: str(v.commentary.headline, 300), summary: str(v.commentary.summary, 8000), conclusion: str(v.commentary.conclusion, 4000) }
        : null,
    };
  } catch {
    return null;
  }
}

export type ReportSaveResult =
  | { status: "done"; saved: { platform: string; inserted: number; updated: number }[]; commentary: "saved" | "kept" | null }
  | { status: "error"; message: string };

export async function saveReportUpload(slug: string, form: FormData): Promise<ReportSaveResult> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to save." };
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const reviewed = parseReviewed(String(form.get("reviewed") ?? ""));
  if (!reviewed) return { status: "error", message: "The reviewed values could not be read. Read the report again." };

  const parts = splitReport(reviewed);
  const off = parts.filter((p) => !auth.client.enabled_sources.includes(p.platform));
  if (off.length) return { status: "error", message: `${off.map((p) => SOURCE_LABELS[p.platform]).join(", ")} is not turned on for ${auth.client.name}.` };
  const built = parts.map((p) => ({ part: p, result: buildScreenshotResult(p) }));
  const failed = built.filter((b) => !b.result.ok);
  if (failed.length) {
    return { status: "error", message: failed.map((b) => `${SOURCE_LABELS[b.part.platform]}: ${b.result.errors.join(" ")}`).join(" ") };
  }
  const f = await resolveFiles(form, auth.client.id, 1);
  if ("error" in f) return { status: "error", message: f.error };
  if (!f.folder) return { status: "error", message: "The uploaded report could not be found. Add it again." };

  // The report is already in Storage (uploaded from the browser) and stays
  // with every platform's upload as evidence.
  const supabase = await createClient();
  const folder = f.folder;
  const fileName = f.names[0];

  const saved: { platform: string; inserted: number; updated: number }[] = [];
  for (const { part, result } of built) {
    if (!result.ok) continue;
    const { data, error } = await supabase.rpc("commit_upload", {
      p_upload_id: crypto.randomUUID(),
      p_client_id: auth.client.id,
      p_source: part.platform,
      p_kind: "file",
      p_file_name: fileName.slice(0, 500),
      p_storage_path: folder,
      p_parser: "report",
      p_period_start: reviewed.period.start,
      p_period_end: reviewed.period.end,
      p_batch: result.batch,
    });
    if (error) {
      const done = saved.map((s) => s.platform).join(", ");
      return { status: "error", message: `${SOURCE_LABELS[part.platform]} was not saved: ${error.message}.${done ? ` Already saved: ${done} (see Upload history).` : ""}` };
    }
    const res = data as { inserted: number; updated: number };
    saved.push({ platform: SOURCE_LABELS[part.platform], inserted: res.inserted, updated: res.updated });
  }

  // The report's own words become that month's commentary, as a draft, unless commentary exists.
  let commentary: "saved" | "kept" | null = null;
  const c = reviewed.commentary;
  const month = `${reviewed.period.start.slice(0, 7)}-01`;
  const wholeMonth = monthRange(month).start === reviewed.period.start && monthRange(month).end === reviewed.period.end;
  if (form.get("importCommentary") === "1" && c && (c.headline || c.summary || c.conclusion) && wholeMonth) {
    const { data: existing } = await supabase.from("monthly_commentary").select("month").eq("client_id", auth.client.id).eq("month", month).maybeSingle();
    if (existing) commentary = "kept";
    else {
      const viewer = await getViewer();
      const { error } = await supabase.from("monthly_commentary").insert({
        client_id: auth.client.id,
        month,
        headline: c.headline ? cleanCopy(c.headline) : null,
        summary: c.summary ? cleanCopy(c.summary) : null,
        conclusion: c.conclusion ? cleanCopy(c.conclusion) : null,
        status: "draft",
        author_id: viewer?.id ?? null,
      });
      if (!error) {
        commentary = "saved";
        await auditAction(auth.client.id, "commentary.save", { month, from: "report import" });
      }
    }
  }
  refresh();
  return { status: "done", saved, commentary };
}
