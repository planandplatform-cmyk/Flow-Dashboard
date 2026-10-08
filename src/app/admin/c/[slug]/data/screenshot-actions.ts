"use server";

import { friendlyDbError } from "@/lib/supabase/errors";
import { refresh } from "next/cache";
import { authorizeStaffForClient } from "@/lib/data/authorize";
import type { UploadOverlap } from "@/lib/data/uploads";
import { readPeriod } from "@/lib/ingest/manual";
import {
  buildScreenshotResult,
  reviewExtraction,
  SCREENSHOT_BREAKDOWNS,
  SCREENSHOT_PLATFORMS,
  type BreakdownReviewItem,
  type CompetitorReviewItem,
  COMPETITOR_METRICS,
  type ReviewedScreenshotData,
  type ReviewItem,
  type ScreenshotPlatform,
} from "@/lib/ingest/screenshot";
import { readScreenshots, screenshotReadingConfigured, ScreenshotReadError } from "@/lib/ingest/screenshot-reader";
import { resolveFiles } from "@/lib/ingest/staged-server";
import type { Period } from "@/lib/ingest/types";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * Screenshots are read once by Claude. The reviewer then corrects the values
 * on screen, and Save sends back only what they confirmed: the model is never
 * called again on save, so what is saved is exactly what was reviewed.
 */

export type ScreenshotReadState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      platform: ScreenshotPlatform;
      period: Period | null;
      items: ReviewItem[];
      breakdowns: BreakdownReviewItem[];
      competitors: CompetitorReviewItem[];
      campaignName: string | null;
      warnings: string[];
      errors: string[];
      overlap: UploadOverlap | null;
      demo: boolean;
    };

function readPlatform(value: FormDataEntryValue | null): ScreenshotPlatform | null {
  const s = String(value ?? "");
  return (SCREENSHOT_PLATFORMS as readonly string[]).includes(s) ? (s as ScreenshotPlatform) : null;
}

async function overlapFor(clientId: string, batch: unknown): Promise<UploadOverlap | null> {
  if (isDemoMode()) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("preview_upload", { p_client_id: clientId, p_batch: batch });
  return (data as UploadOverlap) ?? null;
}

export async function readScreenshotUpload(slug: string, _prev: ScreenshotReadState, form: FormData): Promise<ScreenshotReadState> {
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!screenshotReadingConfigured()) {
    return { status: "error", message: "Reading screenshots and PDFs needs an Anthropic API key. Add ANTHROPIC_API_KEY to the environment variables." };
  }
  const platform = readPlatform(form.get("platform"));
  if (!platform) return { status: "error", message: "Choose which platform the files are from." };
  if (!auth.client.enabled_sources.includes(platform)) {
    return { status: "error", message: `${auth.client.name} does not have this channel turned on. Turn it on in the client's Settings first.` };
  }
  const entered = readPeriod(form);
  if (entered === "invalid") return { status: "error", message: "Enter a valid start and end date, with the end on or after the start." };
  const imgs = await resolveFiles(form, auth.client.id);
  if ("error" in imgs) return { status: "error", message: imgs.error };

  let extraction;
  try {
    extraction = await readScreenshots(imgs.images, platform, new Date().toISOString().slice(0, 10));
  } catch (e) {
    return { status: "error", message: e instanceof ScreenshotReadError ? e.message : "Something went wrong reading the files." };
  }

  const review = reviewExtraction(extraction, platform, entered);
  let overlap: UploadOverlap | null = null;
  const errors = [...review.errors];
  if (review.period) {
    const result = buildScreenshotResult({
      platform,
      period: review.period,
      campaignName: review.campaignName,
      metrics: review.items.map((i) => ({ key: i.key, value: i.value })),
      breakdowns: review.breakdowns,
      competitors: review.competitors,
    });
    errors.push(...result.errors.filter((e) => !errors.includes(e)));
    review.warnings.push(...result.warnings.filter((w) => !review.warnings.includes(w)));
    if (result.ok) overlap = await overlapFor(auth.client.id, result.batch);
  }
  if (!review.items.length && !review.breakdowns.length && !review.competitors.length) errors.push("No numbers could be read from these files.");

  return { status: "ready", platform, ...review, errors, overlap, demo: isDemoMode() };
}

/** Parse and type-check the reviewed JSON sent from the browser. */
function parseReviewed(raw: string): ReviewedScreenshotData | null {
  try {
    const v = JSON.parse(raw) as ReviewedScreenshotData;
    if (!readPlatform(v.platform) || typeof v.period?.start !== "string" || typeof v.period?.end !== "string") return null;
    if (!Array.isArray(v.metrics) || !Array.isArray(v.breakdowns)) return null;
    return {
      platform: v.platform,
      period: { start: v.period.start, end: v.period.end },
      campaignName: typeof v.campaignName === "string" ? v.campaignName.slice(0, 200) : null,
      metrics: v.metrics.map((m) => ({ key: String(m.key), value: Number(m.value) })),
      breakdowns: v.breakdowns
        .filter((b) => SCREENSHOT_BREAKDOWNS.includes(b.type))
        .map((b) => ({ type: b.type, bucket: String(b.bucket).slice(0, 120), percent: Number(b.percent) })),
      competitors: (Array.isArray(v.competitors) ? v.competitors : [])
        .filter((c) => (COMPETITOR_METRICS as readonly string[]).includes(c.metric))
        .map((c) => ({
          company: String(c.company).slice(0, 120),
          own: Boolean(c.own),
          metric: c.metric,
          value: Number(c.value),
          change: c.change === null || c.change === undefined || String(c.change) === "" ? null : Number(c.change),
        })),
    };
  } catch {
    return null;
  }
}

export async function saveScreenshotUpload(
  slug: string,
  form: FormData,
): Promise<{ status: "done"; inserted: number; updated: number } | { status: "error"; message: string }> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to save." };
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const reviewed = parseReviewed(String(form.get("reviewed") ?? ""));
  if (!reviewed) return { status: "error", message: "The reviewed values could not be read. Read the files again." };
  if (!auth.client.enabled_sources.includes(reviewed.platform)) {
    return { status: "error", message: `${auth.client.name} does not have this channel turned on.` };
  }
  const result = buildScreenshotResult(reviewed);
  if (!result.ok) return { status: "error", message: result.errors.join(" ") };
  const imgs = await resolveFiles(form, auth.client.id);
  if ("error" in imgs) return { status: "error", message: imgs.error };
  if (!imgs.folder) return { status: "error", message: "The uploaded files could not be found. Add them again." };

  // The files are already in Storage (uploaded from the browser); they stay
  // with the upload as evidence for every value.
  const supabase = await createClient();
  const uploadId = crypto.randomUUID();
  const folder = imgs.folder;
  const { data, error } = await supabase.rpc("commit_upload", {
    p_upload_id: uploadId,
    p_client_id: auth.client.id,
    p_source: reviewed.platform,
    p_kind: "file",
    p_file_name: imgs.names.join(", ").slice(0, 500),
    p_storage_path: folder,
    p_parser: "screenshot",
    p_period_start: reviewed.period.start,
    p_period_end: reviewed.period.end,
    p_batch: result.batch,
  });
  if (error) return { status: "error", message: `Nothing was saved. ${friendlyDbError(error.message)}` };
  refresh();
  const res = data as { inserted: number; updated: number };
  return { status: "done", inserted: res.inserted, updated: res.updated };
}
