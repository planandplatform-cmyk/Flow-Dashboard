"use client";

import { useState, useTransition } from "react";
import { Button, Notice } from "@/components/form";
import type { UploadLogEntry } from "@/lib/data/uploads";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { rollbackUpload } from "./actions";

const STATUS: Record<UploadLogEntry["status"], { label: string; className: string }> = {
  succeeded: { label: "Saved", className: "border-teal-800 bg-teal-950 text-teal" },
  rolled_back: { label: "Rolled back", className: "border-line bg-raised text-fg-secondary" },
  failed: { label: "Failed", className: "border-negative/40 bg-negative/10 text-negative" },
  running: { label: "Saving", className: "border-line bg-raised text-fg-secondary" },
  pending: { label: "Pending", className: "border-line bg-raised text-fg-secondary" },
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const day = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

export function UploadHistory({ slug, uploads, demo }: { slug: string; uploads: UploadLogEntry[]; demo: boolean }) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function rollback(id: string) {
    start(async () => {
      const res = await rollbackUpload(slug, id);
      setConfirming(null);
      if (!res.ok) return setMessage({ tone: "error", text: res.message });
      const kept = res.kept > 0 ? ` ${res.kept} value${res.kept === 1 ? " was" : "s were"} kept because a later upload replaced them.` : "";
      setMessage({ tone: "success", text: `Rolled back. ${res.removed} values removed and ${res.restored} earlier values restored.${kept}` });
    });
  }

  if (demo) return <Notice tone="info">Demo mode: the upload history appears once Supabase is connected.</Notice>;
  if (!uploads.length) return <p className="text-sm text-fg-secondary">No uploads yet.</p>;

  return (
    <div className="space-y-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Upload history</caption>
          <thead className="bg-raised">
            <tr>
              {["When", "What", "Platform", "Dates", "Rows", "Status", ""].map((h, i) => (
                <th key={i} scope="col" className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-fg-secondary ${h === "Rows" ? "text-right" : "text-left"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface">
            {uploads.map((u) => (
              <tr key={u.id} className="border-t border-line align-top transition-colors hover:bg-teal-950">
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="text-fg">{dateTime(u.created_at)}</div>
                  <div className="text-xs text-fg-muted">{u.uploader?.email ?? "Unknown"}</div>
                </td>
                <td className="max-w-[240px] px-4 py-3">
                  <div className="truncate text-fg" title={u.file_name ?? undefined}>
                    {u.kind === "manual" ? "Manual entry" : u.file_name}
                  </div>
                  <div className="truncate text-xs text-fg-muted">{u.parser}</div>
                </td>
                <td className="px-4 py-3 text-fg-secondary">{SOURCE_LABELS[u.source]}</td>
                <td className="whitespace-nowrap px-4 py-3 text-fg-secondary">
                  {u.period_start ? `${day(u.period_start)} to ${day(u.period_end)}` : ""}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-fg-secondary">
                  {u.rows_inserted.toLocaleString()} new
                  <br />
                  {u.rows_updated.toLocaleString()} replaced
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS[u.status].className}`}>{STATUS[u.status].label}</span>
                  {u.status === "rolled_back" && u.rolled_back_at && (
                    <div className="mt-1 text-xs text-fg-muted">
                      {dateTime(u.rolled_back_at)}
                      {u.rolled_back_by_user ? ` by ${u.rolled_back_by_user.email}` : ""}
                    </div>
                  )}
                  {u.error && <div className="mt-1 text-xs text-negative">{u.error}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {u.status === "succeeded" &&
                    (confirming === u.id ? (
                      <div className="flex justify-end gap-2">
                        <Button variant="danger" onClick={() => rollback(u.id)} disabled={pending} className="px-3 py-1.5">
                          {pending ? "Rolling back..." : "Confirm"}
                        </Button>
                        <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending} className="px-3 py-1.5">
                          Keep
                        </Button>
                      </div>
                    ) : (
                      <Button variant="secondary" onClick={() => setConfirming(u.id)} className="px-3 py-1.5">
                        Roll back
                      </Button>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-muted">
        Rolling back removes what an upload added and restores any values it replaced. Values a later upload has replaced again are left as they are.
      </p>
    </div>
  );
}
