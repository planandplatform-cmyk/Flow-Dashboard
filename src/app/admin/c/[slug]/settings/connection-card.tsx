"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import type { ConnectionStatus } from "@/lib/data/admin";
import type { SyncState } from "./sync-actions";

type FormAction = (prev: SyncState, form: FormData) => Promise<SyncState>;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

const TRIGGER: Record<string, string> = { scheduled: "Nightly", manual: "Sync now", backfill: "History" };

function StateNotice({ state }: { state: SyncState }) {
  if (state.status === "idle") return null;
  return <Notice tone={state.status === "done" ? "success" : "error"}>{state.message}</Notice>;
}

/** What differs between channels: names and where to find things. */
export interface ChannelCopy {
  title: string;
  blurb: string;
  idLabel: string;
  placeholder: string;
  hint: string;
  accessHelp: string;
  inputMode?: "numeric" | "url";
}

export function ConnectionCard({
  copy,
  status,
  serviceEmail,
  ready,
  demo,
  connect,
  syncNow,
  pullHistory,
  disconnect,
}: {
  copy: ChannelCopy;
  status: ConnectionStatus | null;
  serviceEmail: string | null;
  ready: boolean;
  demo: boolean;
  connect: FormAction;
  syncNow: () => Promise<SyncState>;
  pullHistory: FormAction;
  disconnect: () => Promise<SyncState>;
}) {
  const [connectState, connectAction, connecting] = useActionState(connect, { status: "idle" });
  const [historyState, historyAction, pulling] = useActionState(pullHistory, { status: "idle" });
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);
  const connected = Boolean(status?.propertyId) && status?.status !== "not_connected";
  const busy = connecting || pulling || pending;

  return (
    <div className="space-y-5 rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-fg">{copy.title}</p>
          <p className="mt-0.5 text-fg-secondary">
            {connected
              ? `${status!.propertyId}. ${status!.lastSyncedAt ? `Last updated ${when(status!.lastSyncedAt)}.` : "Not synced yet."}`
              : copy.blurb}
          </p>
        </div>
        {connected && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${status!.status === "error" ? "bg-negative/10 text-negative" : "bg-teal-950 text-teal-100"}`}
          >
            {status!.status === "error" ? "Needs attention" : "Connected"}
          </span>
        )}
      </div>

      {!ready && !demo && (
        <Notice tone="info">
          Add GOOGLE_SERVICE_ACCOUNT_KEY, SUPABASE_SECRET_KEY and CRON_SECRET in Vercel, then redeploy. See
          docs/connect-google-analytics.md.
        </Notice>
      )}
      {connected && status!.status === "error" && status!.lastError && <Notice tone="error">{status!.lastError}</Notice>}

      {serviceEmail && (
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Service account</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-raised px-2 py-1 text-xs text-fg">{serviceEmail}</code>
            <Button
              type="button"
              variant="secondary"
              className="!px-3 !py-1 text-xs"
              onClick={() => navigator.clipboard.writeText(serviceEmail).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-fg-muted">{copy.accessHelp}</p>
        </div>
      )}

      <form action={connectAction} className="space-y-3">
        <StateNotice state={connectState} />
        <Field label={copy.idLabel} htmlFor={`${copy.title}-account`} hint={copy.hint}>
          <div className="flex gap-2">
            <input
              id={`${copy.title}-account`}
              name="account_id"
              inputMode={copy.inputMode}
              placeholder={copy.placeholder}
              defaultValue={status?.propertyId ?? ""}
              className={inputClass}
              disabled={demo || !ready}
            />
            <Button type="submit" disabled={busy || demo || !ready} className="shrink-0">
              {connecting ? "Pulling history..." : connected ? "Save and re-pull" : "Connect"}
            </Button>
          </div>
        </Field>
      </form>

      {connected && (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !ready}
              onClick={() => start(async () => setState(await syncNow()))}
            >
              {pending ? "Working..." : "Sync last 30 days"}
            </Button>
            <Button type="button" variant="danger" disabled={busy} onClick={() => start(async () => setState(await disconnect()))}>
              Turn off
            </Button>
          </div>
          <StateNotice state={state} />

          <form action={historyAction} className="space-y-3 border-t border-line pt-5">
            <p className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Pull a date range</p>
            <StateNotice state={historyState} />
            <div className="flex flex-wrap items-end gap-2">
              <input type="date" name="start" required aria-label="From" className={`${inputClass} !w-auto`} />
              <input type="date" name="end" required aria-label="To" className={`${inputClass} !w-auto`} />
              <Button type="submit" variant="secondary" disabled={busy || !ready}>
                {pulling ? "Pulling..." : "Pull"}
              </Button>
            </div>
            <p className="text-xs text-fg-muted">Replaces any numbers uploaded for this channel for those dates.</p>
          </form>
        </>
      )}

      {status && status.runs.length > 0 && (
        <div className="border-t border-line pt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-secondary">Recent syncs</p>
          <ul className="space-y-1.5 text-xs">
            {status.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 text-fg-secondary">
                <span className="w-28 text-fg">{when(r.started_at)}</span>
                <span className="w-16">{TRIGGER[r.trigger] ?? r.trigger}</span>
                <span>
                  {r.period_start} to {r.period_end}
                </span>
                <span className={r.status === "failed" ? "text-negative" : r.status === "succeeded" ? "text-teal-100" : ""}>
                  {r.status === "succeeded"
                    ? `${r.rows_upserted.toLocaleString("en-US")} numbers`
                    : r.status === "failed"
                      ? "Failed"
                      : "Running"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
