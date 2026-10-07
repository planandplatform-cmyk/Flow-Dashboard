"use client";

import Link from "next/link";
import { useActionState, useRef, useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import { formatMetric } from "@/lib/metrics/format";
import { METRICS } from "@/lib/metrics/config";
import { SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";
import { commitUpload, previewUpload, type CommitState, type PreviewState } from "./actions";

interface SourceOption {
  value: DataSource;
  label: string;
  enabled: boolean;
}

const GRANULARITY: Record<string, string> = {
  daily: "Daily values",
  period: "Totals for the period",
  mixed: "Daily values and period totals",
  lifetime: "Posts with lifetime totals",
  snapshot: "Audience breakdown",
};

const TABLE_LABELS: Record<string, string> = {
  daily: "Daily values",
  period: "Period totals",
  posts: "Posts",
  snapshots: "Audience shares",
  adDaily: "Daily ad delivery",
};

const fmtDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "N/A";

export function UploadPanel({ slug, clientName, sources }: { slug: string; clientName: string; sources: SourceOption[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, previewAction, previewing] = useActionState<PreviewState, FormData>(previewUpload.bind(null, slug), { status: "idle" });
  const [commit, setCommit] = useState<CommitState>({ status: "idle" });
  const [committing, startCommit] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [, startPreview] = useTransition();
  // The exact form data that was previewed, so Save commits the same file and
  // options even if the form changes afterwards.
  const previewed = useRef<FormData | null>(null);
  const [dismissed, setDismissed] = useState(false);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    previewed.current = data;
    setDismissed(false);
    setCommit({ status: "idle" });
    startPreview(() => previewAction(data));
  }

  function onCommit() {
    const data = previewed.current;
    if (!data) return;
    startCommit(async () => setCommit(await commitUpload(slug, data)));
  }

  function reset() {
    formRef.current?.reset();
    previewed.current = null;
    setDismissed(true);
    setFileName(null);
    setCommit({ status: "idle" });
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="space-y-5 self-start rounded-xl border border-line bg-surface p-5"
      >
        <Field label="Platform" htmlFor="source" hint="Leave on auto-detect unless the preview picks the wrong one.">
          <select id="source" name="source" className={inputClass} defaultValue="">
            <option value="">Auto-detect</option>
            {sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
                {s.enabled ? "" : " (not turned on)"}
              </option>
            ))}
          </select>
        </Field>

        <Field label="File" htmlFor="file" hint="CSV or Excel exported from the platform, up to 4 MB.">
          <label
            htmlFor="file"
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-raised px-4 py-6 text-center transition hover:border-teal"
          >
            <span className="text-sm font-medium text-fg">{fileName ?? "Choose a file"}</span>
            <span className="mt-1 text-xs text-fg-muted">.csv, .xlsx or .xls</span>
          </label>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept=".csv,.tsv,.txt,.xlsx,.xls,.xlsm"
            className="sr-only"
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
          />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Period covered</legend>
          <p className="text-xs text-fg-muted">Only needed when the file has no dates of its own (for example a landing page report).</p>
          <div className="grid grid-cols-2 gap-3">
            <input aria-label="Period start" name="periodStart" type="date" className={inputClass} />
            <input aria-label="Period end" name="periodEnd" type="date" className={inputClass} />
          </div>
        </fieldset>

        <Button type="submit" disabled={previewing || committing} className="w-full">
          {previewing ? "Reading file..." : "Preview"}
        </Button>
      </form>

      <div className="min-w-0 space-y-6" aria-live="polite">
        {(state.status === "idle" || dismissed) && (
          <div className="rounded-xl border border-dashed border-line p-8 text-sm leading-relaxed text-fg-secondary">
            <p className="font-medium text-fg">How it works</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5">
              <li>Export the report from the platform (GA4, Meta Business Suite, Ads Manager, Shopify, TikTok or LinkedIn).</li>
              <li>Choose the file and press Preview. Nothing is saved yet.</li>
              <li>Check the totals against the platform, then save.</li>
              <li>Every upload can be rolled back from the history tab.</li>
            </ol>
          </div>
        )}

        {state.status === "error" && !dismissed && <Notice tone="error">{state.message}</Notice>}

        {commit.status === "done" && (
          <Notice tone="success" title="Saved">
            {commit.inserted.toLocaleString()} new and {commit.updated.toLocaleString()} updated values are now in {clientName}&apos;s report.{" "}
            <Link href={`/c/${slug}`} className="underline">View report</Link> ·{" "}
            <Link href="?tab=history" className="underline">Upload history</Link> ·{" "}
            <button type="button" onClick={reset} className="underline">Upload another</button>
          </Notice>
        )}
        {commit.status === "error" && <Notice tone="error">{commit.message}</Notice>}

        {state.status === "ready" && !dismissed && commit.status !== "done" && (
          <Preview
            state={state}
            clientName={clientName}
            committing={committing}
            onCommit={onCommit}
            onCancel={reset}
          />
        )}
      </div>
    </div>
  );
}

function Preview({
  state,
  clientName,
  committing,
  onCommit,
  onCancel,
}: {
  state: Extract<PreviewState, { status: "ready" }>;
  clientName: string;
  committing: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const p = state.preview;
  const overlap = state.overlap;
  const existing = overlap ? Object.values(overlap).reduce((s, o) => s + o.existing, 0) : 0;
  const changed = overlap ? Object.values(overlap).reduce((s, o) => s + o.changed, 0) : 0;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{state.fileName}</p>
        <h2 className="mt-1 text-lg font-semibold">{p.parserLabel}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <Stat label="Platform" value={p.sources.map((s) => SOURCE_LABELS[s]).join(", ") || "N/A"} />
          <Stat label="Dates" value={p.periodStart ? `${fmtDate(p.periodStart)} to ${fmtDate(p.periodEnd)}` : "N/A"} />
          <Stat label="Type" value={GRANULARITY[p.granularity] ?? p.granularity} />
          <Stat label="Rows read" value={p.rowsRead.toLocaleString()} />
        </dl>
      </div>

      {p.errors.length > 0 && (
        <Notice tone="error" title="This file cannot be saved yet">
          <ul className="list-disc space-y-1 pl-5">
            {p.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </Notice>
      )}

      {p.warnings.length > 0 && (
        <Notice tone="warning" title="Check before saving">
          <ul className="list-disc space-y-1 pl-5">
            {p.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Notice>
      )}

      {p.ok && (
        <div className="rounded-xl border border-line bg-surface p-5 text-sm">
          <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">What will change</h3>
          {overlap ? (
            <>
              <p className="mt-3 text-fg">
                {existing === 0 ? (
                  "All of this is new data. Nothing will be overwritten."
                ) : (
                  <>
                    <span className="font-semibold text-teal">{existing.toLocaleString()}</span> values already exist and will be replaced
                    {changed > 0 ? <>, <span className="font-semibold text-negative">{changed.toLocaleString()}</span> of them with a different number</> : " with the same numbers"}.
                  </>
                )}
              </p>
              <ul className="mt-3 grid grid-cols-1 gap-2 text-fg-secondary sm:grid-cols-2">
                {(Object.keys(overlap) as (keyof typeof overlap)[])
                  .filter((k) => overlap[k].incoming > 0 || overlap[k].existing > 0)
                  .map((k) => (
                    <li key={k} className="rounded-lg bg-raised px-3 py-2">
                      {TABLE_LABELS[k]}: {overlap[k].incoming.toLocaleString()} in file
                      {overlap[k].existing > 0 && `, ${overlap[k].existing.toLocaleString()} replace existing`}
                    </li>
                  ))}
              </ul>
            </>
          ) : (
            <p className="mt-3 text-fg-secondary">
              {state.demo ? "Demo mode: connect Supabase to compare with existing data and save." : "No comparison available."}
            </p>
          )}
        </div>
      )}

      {p.totals.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[420px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
              Totals in this file. Compare these with the platform before saving.
            </caption>
            <thead className="bg-raised">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">Metric</th>
                <th scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-fg-secondary">Total</th>
              </tr>
            </thead>
            <tbody className="bg-surface">
              {p.totals.map((t) => (
                <tr key={`${t.source}-${t.metric_key}`} className="border-t border-line">
                  <td className="px-4 py-2.5">
                    <span className="text-fg-muted">{SOURCE_LABELS[t.source]} · </span>
                    {METRICS[t.metric_key]?.label ?? t.metric_key}
                    {METRICS[t.metric_key]?.aggregation.type === "last" && <span className="text-fg-muted"> (latest)</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-teal">{formatMetric(t.metric_key, t.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(p.posts.length > 0 || p.campaigns.length > 0 || p.snapshots.length > 0) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {p.posts.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">{p.counts.posts} posts, top 5 by views</h3>
              <ul className="mt-3 space-y-2">
                {p.posts.map((post, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="truncate text-fg">{post.summary}</span>
                    <span className="shrink-0 tabular-nums text-fg-secondary">{post.views?.toLocaleString() ?? "N/A"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {p.campaigns.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Campaigns</h3>
              <ul className="mt-3 space-y-1.5 text-fg">
                {p.campaigns.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </div>
          )}
          {p.snapshots.length > 0 && (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm">
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Audience shares</h3>
              <ul className="mt-3 space-y-1.5">
                {p.snapshots.map((s, i) => (
                  <li key={i} className="flex justify-between">
                    <span className="text-fg">{s.bucket}</span>
                    <span className="tabular-nums text-fg-secondary">{(s.share * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(p.mappedColumns.length > 0 || p.unmappedColumns.length > 0) && (
        <details className="rounded-xl border border-line bg-surface p-5 text-sm">
          <summary className="cursor-pointer text-fg-secondary">
            Columns: {p.mappedColumns.length} used
            {p.unmappedColumns.length > 0 && `, ${p.unmappedColumns.length} not recognized`}
          </summary>
          {p.unmappedColumns.length > 0 && (
            <p className="mt-3 text-fg-secondary">
              <span className="text-fg">Not recognized (ignored):</span> {p.unmappedColumns.join(", ")}
            </p>
          )}
          <p className="mt-2 text-fg-muted">Used: {p.mappedColumns.join(", ")}</p>
        </details>
      )}

      <div className="flex flex-wrap gap-3">
        {p.ok && (
          <Button type="button" onClick={onCommit} disabled={committing || state.demo}>
            {committing ? "Saving..." : `Save to ${clientName}`}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={committing}>
          {p.ok ? "Cancel" : "Start over"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-1 text-fg">{value}</dd>
    </div>
  );
}
