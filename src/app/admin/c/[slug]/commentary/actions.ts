"use server";

import { refresh } from "next/cache";
import { DraftError, draftCommentary, draftingConfigured, NOTE_SECTIONS, type Draft } from "@/lib/commentary/drafter";
import { cleanCopy } from "@/lib/commentary/copy";
import { siteUrl } from "@/lib/data/admin";
import { auditAction, authorizeStaffForClient } from "@/lib/data/authorize";
import { loadMonthFacts } from "@/lib/data/commentary";
import { getViewer } from "@/lib/data/portal";
import { DATA_SOURCES } from "@/lib/metrics/types";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type CommentaryFields = {
  headline: string;
  summary: string;
  platforms: Record<string, { headline: string; body: string }>;
  notes: Record<string, string>;
  conclusion: string;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).trim() : "");

/** Accept only known keys and bounded text from the browser. */
function readFields(raw: CommentaryFields): CommentaryFields {
  const platforms: CommentaryFields["platforms"] = {};
  for (const s of DATA_SOURCES) {
    const p = raw.platforms?.[s];
    if (p && (text(p.headline, 300) || text(p.body, 3000))) platforms[s] = { headline: text(p.headline, 300), body: text(p.body, 3000) };
  }
  const notes: CommentaryFields["notes"] = {};
  for (const k of NOTE_SECTIONS) if (text(raw.notes?.[k], 2000)) notes[k] = text(raw.notes[k], 2000);
  return { headline: text(raw.headline, 300), summary: text(raw.summary, 8000), platforms, notes, conclusion: text(raw.conclusion, 4000) };
}

export type SaveResult = { status: "done"; message: string; savedStatus: "draft" | "published" } | { status: "error"; message: string };

export async function saveCommentary(
  slug: string,
  month: string,
  intent: "draft" | "publish" | "unpublish",
  raw: CommentaryFields,
): Promise<SaveResult> {
  if (isDemoMode()) return { status: "error", message: "Demo mode: connect Supabase to save." };
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!MONTH.test(month)) return { status: "error", message: "Choose a month." };
  const f = readFields(raw);
  if (intent === "publish" && (!f.headline || !f.summary)) {
    return { status: "error", message: "Add at least a headline and a summary before publishing." };
  }
  // House style is enforced on save too, for anything typed by hand.
  const clean = (s: string) => (s ? cleanCopy(s) : null);
  const viewer = await getViewer();
  const status = intent === "publish" ? "published" : "draft";
  const row = {
    client_id: auth.client.id,
    month,
    headline: clean(f.headline),
    summary: clean(f.summary),
    platform_narratives: Object.fromEntries(
      Object.entries(f.platforms).map(([k, v]) => [k, { headline: cleanCopy(v.headline), body: cleanCopy(v.body) }]),
    ),
    section_notes: Object.fromEntries(Object.entries(f.notes).map(([k, v]) => [k, cleanCopy(v)])),
    conclusion: clean(f.conclusion),
    status,
    author_id: viewer?.id ?? null,
    ...(intent === "publish" ? { published_at: new Date().toISOString() } : intent === "unpublish" ? { published_at: null } : {}),
  };
  const supabase = await createClient();
  const { error } = await supabase.from("monthly_commentary").upsert(row, { onConflict: "client_id,month" });
  if (error) return { status: "error", message: `Not saved. ${error.message}` };
  await auditAction(auth.client.id, `commentary.${intent === "draft" ? "save" : intent}`, { month });
  refresh();
  return {
    status: "done",
    savedStatus: status,
    message: intent === "publish" ? "Published. The client can see it now." : intent === "unpublish" ? "Unpublished. The client no longer sees it." : "Draft saved.",
  };
}

export type DraftResult = { status: "done"; draft: Draft; demo: boolean } | { status: "error"; message: string };

export async function draftWithAI(slug: string, month: string): Promise<DraftResult> {
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  if (!MONTH.test(month)) return { status: "error", message: "Choose a month." };
  if (!draftingConfigured()) return { status: "error", message: "Drafting needs an Anthropic API key. Add ANTHROPIC_API_KEY to the environment variables." };

  const facts = await loadMonthFacts(auth.client, month);
  if (!facts.sections.length) return { status: "error", message: "There is no data for this month yet. Upload it first, then draft." };

  let signer = "Flow Forward Media";
  const viewer = await getViewer();
  if (viewer && !viewer.demo) {
    const supabase = await createClient();
    const { data } = await supabase.from("users").select("full_name").eq("id", viewer.id).maybeSingle();
    if (data?.full_name) signer = data.full_name;
  }
  try {
    const reportUrl = `${await siteUrl()}/c/${auth.client.slug}?month=${month.slice(0, 7)}`;
    const draft = await draftCommentary(facts, { reportUrl, signer });
    await auditAction(auth.client.id, "commentary.ai_draft", { month });
    return { status: "done", draft, demo: isDemoMode() };
  } catch (e) {
    return { status: "error", message: e instanceof DraftError ? e.message : "Something went wrong writing the draft." };
  }
}
