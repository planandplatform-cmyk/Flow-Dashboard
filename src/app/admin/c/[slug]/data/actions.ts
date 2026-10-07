"use server";

import { refresh } from "next/cache";
import { authorizeStaffForClient } from "@/lib/data/authorize";
import type { Client } from "@/lib/data/portal";
import type { UploadOverlap } from "@/lib/data/uploads";
import { parseUpload } from "@/lib/ingest";
import { buildManualBatch, readPeriod } from "@/lib/ingest/manual";
import type { ParseResult } from "@/lib/ingest/types";
import { DATA_SOURCES, SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * Server actions for the data page. Every action re-checks that the caller is
 * FFM staff; the database checks again through row-level security.
 */

export type PreviewSummary = Omit<ParseResult, "batch"> & {
  counts: { daily: number; period: number; posts: number; snapshots: number; adDaily: number; adCampaigns: number };
  campaigns: string[];
  posts: { platform: DataSource; summary: string | null; views: number | null; published_at: string }[];
  snapshots: { platform: DataSource; breakdown_type: string; bucket: string; share: number }[];
};

export type PreviewState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: PreviewSummary; overlap: UploadOverlap | null; fileName: string; demo: boolean };

export type CommitState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; inserted: number; updated: number; uploadId: string };

const authorize = authorizeStaffForClient;

function readSource(value: FormDataEntryValue | null): DataSource | undefined {
  const s = String(value ?? "");
  return (DATA_SOURCES as readonly string[]).includes(s) ? (s as DataSource) : undefined;
}

const today = () => new Date().toISOString().slice(0, 10);

async function parseFromForm(form: FormData): Promise<{ result: ParseResult; file: File } | { error: string }> {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to upload." };
  const period = readPeriod(form);
  if (period === "invalid") return { error: "Enter a valid start and end date, with the end on or after the start." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = parseUpload(bytes, { fileName: file.name, source: readSource(form.get("source")), period, today: today() });
  return { result, file };
}

function summarizeResult(result: ParseResult, client: Client): PreviewSummary {
  const { batch, ...rest } = result;
  const disabled = result.sources.filter((s) => !client.enabled_sources.includes(s));
  const warnings = [...rest.warnings];
  if (disabled.length) {
    warnings.unshift(
      `${client.name} does not have ${disabled.map((s) => SOURCE_LABELS[s]).join(" or ")} turned on. The data will be saved but stays hidden from the report until it is turned on.`,
    );
  }
  return {
    ...rest,
    warnings,
    counts: {
      daily: batch.daily.length,
      period: batch.period.length,
      posts: batch.posts.length,
      snapshots: batch.snapshots.length,
      adDaily: batch.adDaily.length,
      adCampaigns: batch.adCampaigns.length,
    },
    campaigns: batch.adCampaigns.map((c) => c.name),
    posts: [...batch.posts]
      .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
      .slice(0, 5)
      .map((p) => ({ platform: p.platform, summary: p.summary, views: p.views, published_at: p.published_at })),
    snapshots: batch.snapshots.slice(0, 30).map((s) => ({ platform: s.platform, breakdown_type: s.breakdown_type, bucket: s.bucket, share: s.share })),
  };
}

// ---------------------------------------------------------------------------
// File upload: preview, then commit
// ---------------------------------------------------------------------------

export async function previewUpload(slug: string, _prev: PreviewState, form: FormData): Promise<PreviewState> {
  const auth = await authorize(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const parsed = await parseFromForm(form);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  const { result, file } = parsed;

  let overlap: UploadOverlap | null = null;
  if (result.ok && !isDemoMode()) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("preview_upload", { p_client_id: auth.client.id, p_batch: result.batch });
    if (error) return { status: "error", message: `Could not compare with existing data: ${error.message}` };
    overlap = data as UploadOverlap;
  }
  return { status: "ready", preview: summarizeResult(result, auth.client), overlap, fileName: file.name, demo: isDemoMode() };
}

export async function commitUpload(slug: string, form: FormData): Promise<CommitState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to save uploads." };
  const auth = await authorize(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const parsed = await parseFromForm(form);
  if ("error" in parsed) return { status: "error", message: parsed.error };
  const { result, file } = parsed;
  if (!result.ok) return { status: "error", message: result.errors.join(" ") };

  const supabase = await createClient();
  const uploadId = crypto.randomUUID();
  const safeName = file.name.replace(/[^\w.\-]+/g, "_").slice(-120);
  const storagePath = `${auth.client.id}/${uploadId}/${safeName}`;

  // Keep the original file so an upload can always be audited or re-parsed.
  const stored = await supabase.storage.from("uploads").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (stored.error) return { status: "error", message: `Could not store the file: ${stored.error.message}` };

  const primary = readSource(form.get("source")) ?? result.sources[0] ?? "ga4";
  const { data, error } = await supabase.rpc("commit_upload", {
    p_upload_id: uploadId,
    p_client_id: auth.client.id,
    p_source: result.sources.length === 1 ? result.sources[0] : primary,
    p_kind: "file",
    p_file_name: file.name,
    p_storage_path: storagePath,
    p_parser: result.parserId,
    p_period_start: result.periodStart,
    p_period_end: result.periodEnd,
    p_batch: result.batch,
  });
  if (error) {
    await supabase.storage.from("uploads").remove([storagePath]);
    return { status: "error", message: `Nothing was saved. ${error.message}` };
  }
  refresh();
  const res = data as { inserted: number; updated: number };
  return { status: "done", inserted: res.inserted, updated: res.updated, uploadId };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

export async function rollbackUpload(
  slug: string,
  uploadId: string,
): Promise<{ ok: true; removed: number; restored: number; kept: number } | { ok: false; message: string }> {
  if (isDemoMode()) return { ok: false, message: "Demo mode: nothing to roll back." };
  const auth = await authorize(slug);
  if ("error" in auth) return { ok: false, message: auth.error };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("rollback_upload", { p_upload_id: uploadId });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, ...(data as { removed: number; restored: number; kept: number }) };
}

// ---------------------------------------------------------------------------
// Manual entry
// ---------------------------------------------------------------------------

export type ManualState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; message: string };

export async function saveManualEntry(slug: string, _prev: ManualState, form: FormData): Promise<ManualState> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to save entries." };
  const auth = await authorize(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const built = buildManualBatch(form);
  if ("error" in built) return { status: "error", message: built.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("commit_upload", {
    p_upload_id: crypto.randomUUID(),
    p_client_id: auth.client.id,
    p_source: built.source,
    p_kind: "manual",
    p_file_name: null,
    p_storage_path: null,
    p_parser: String(form.get("mode")) === "metric" ? `manual:${form.get("metric")}` : `manual:${form.get("breakdownType")}`,
    p_period_start: built.period.start,
    p_period_end: built.period.end,
    p_batch: built.batch,
  });
  if (error) return { status: "error", message: `Nothing was saved. ${error.message}` };
  refresh();
  return { status: "done", message: "Saved. It appears in the upload history and can be rolled back from there." };
}
