/**
 * Plain-English lines for the activity log. Pure, so wording is tested.
 */
import { formatMonth, formatRange } from "@/lib/dates";
import { SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";

export type ActivityGroup = "uploads" | "syncs" | "commentary" | "events" | "settings";

export const ACTIVITY_GROUPS: { id: ActivityGroup; label: string }[] = [
  { id: "uploads", label: "Uploads" },
  { id: "syncs", label: "Syncs" },
  { id: "commentary", label: "Commentary" },
  { id: "events", label: "Events" },
  { id: "settings", label: "Settings and logins" },
];

export function activityGroup(action: string): ActivityGroup {
  if (action.startsWith("upload.")) return "uploads";
  if (action.startsWith("sync.")) return "syncs";
  if (action.startsWith("commentary.")) return "commentary";
  if (action.startsWith("event.")) return "events";
  return "settings";
}

const src = (s: unknown) => SOURCE_LABELS[s as DataSource] ?? String(s ?? "");
const n = (v: unknown) => new Intl.NumberFormat("en-US").format(Number(v ?? 0));
const month = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? formatMonth(v) : "");

export function describeActivity(action: string, d: Record<string, unknown>): string {
  switch (action) {
    case "upload.commit":
      return d.kind === "manual"
        ? `Entered ${src(d.source)} numbers by hand: ${n(d.inserted)} new, ${n(d.updated)} updated`
        : `Uploaded ${d.file_name ?? "a file"} (${src(d.source)}): ${n(d.inserted)} new, ${n(d.updated)} updated`;
    case "upload.rollback":
      return `Rolled back an upload: ${n(d.removed)} values removed, ${n(d.restored)} earlier values restored`;
    case "commentary.save":
      return `Saved draft commentary for ${month(d.month)}`;
    case "commentary.publish":
      return `Published commentary for ${month(d.month)}`;
    case "commentary.unpublish":
      return `Unpublished commentary for ${month(d.month)}`;
    case "commentary.ai_draft":
      return `Drafted ${month(d.month)} commentary with AI`;
    case "event.create":
      return `Added event: ${d.label}`;
    case "event.update":
      return `Edited event: ${d.label}`;
    case "event.delete":
      return `Removed event${d.label ? `: ${d.label}` : ""}`;
    case "client.create":
      return "Created the client";
    case "client.update": {
      const on = (d.turned_on as string[] | undefined)?.map(src) ?? [];
      const off = (d.turned_off as string[] | undefined)?.map(src) ?? [];
      const parts = [on.length ? `turned on ${on.join(", ")}` : "", off.length ? `turned off ${off.join(", ")}` : ""].filter(Boolean);
      return parts.length ? `Updated settings: ${parts.join("; ")}` : "Updated client details";
    }
    case "client.archive":
      return "Archived the client";
    case "client.unarchive":
      return "Restored the client from the archive";
    case "client.user_added":
      return `${d.invited ? "Invited" : "Gave access to"} ${d.email}`;
    case "client.user_removed":
      return "Removed a login";
    default:
      if (action.startsWith("sync.")) {
        const kind = action === "sync.manual" ? "Manual sync" : action === "sync.backfill" ? "Backfill" : "Nightly sync";
        const range =
          typeof d.period_start === "string" && typeof d.period_end === "string" ? `, ${formatRange({ start: d.period_start, end: d.period_end })}` : "";
        return `${kind} of ${src(d.source)}${range}${d.rows ? `: ${n(d.rows)} values` : ""}`;
      }
      return action;
  }
}
