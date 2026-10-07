"use server";

import { refresh } from "next/cache";
import { auditAction, authorizeStaffForClient } from "@/lib/data/authorize";
import { cleanCopy } from "@/lib/commentary/copy";
import { isISODate } from "@/lib/dates";
import { getViewer } from "@/lib/data/portal";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type EventState = { status: "idle" } | { status: "error"; message: string } | { status: "done"; message: string };

const DEMO: EventState = { status: "error", message: "Demo mode: connect Supabase to save events." };

function readEvent(form: FormData): { date: string; label: string; description: string | null } | string {
  const date = String(form.get("date") ?? "");
  const label = cleanCopy(String(form.get("label") ?? "")).slice(0, 140);
  const description = cleanCopy(String(form.get("description") ?? "")).slice(0, 1000) || null;
  if (!isISODate(date)) return "Enter the date it happened.";
  if (!label) return "Describe what happened in a few words.";
  return { date, label, description };
}

export async function saveEvent(slug: string, _prev: EventState, form: FormData): Promise<EventState> {
  if (isDemoMode()) return DEMO;
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const event = readEvent(form);
  if (typeof event === "string") return { status: "error", message: event };
  const id = String(form.get("id") ?? "");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("annotations").update(event).eq("id", id).eq("client_id", auth.client.id);
    if (error) return { status: "error", message: `Not saved. ${error.message}` };
    await auditAction(auth.client.id, "event.update", { id, ...event });
  } else {
    const viewer = await getViewer();
    const { error } = await supabase.from("annotations").insert({ ...event, client_id: auth.client.id, created_by: viewer?.id });
    if (error) return { status: "error", message: `Not saved. ${error.message}` };
    await auditAction(auth.client.id, "event.create", event);
  }
  refresh();
  return { status: "done", message: id ? "Event updated." : "Event added. It now shows on every chart for this client." };
}

export async function deleteEvent(slug: string, id: string): Promise<EventState> {
  if (isDemoMode()) return DEMO;
  const auth = await authorizeStaffForClient(slug);
  if ("error" in auth) return { status: "error", message: auth.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("annotations").delete().eq("id", id).eq("client_id", auth.client.id).select("date, label");
  if (error) return { status: "error", message: error.message };
  await auditAction(auth.client.id, "event.delete", { id, ...(data?.[0] ?? {}) });
  refresh();
  return { status: "done", message: "Event removed." };
}
