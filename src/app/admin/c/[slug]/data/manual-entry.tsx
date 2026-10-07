"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import type { BreakdownType } from "@/lib/ingest/types";
import type { DataSource, MetricFormat } from "@/lib/metrics/types";
import { saveManualEntry, type ManualState } from "./actions";

export interface MetricOption {
  key: string;
  label: string;
  source: DataSource;
  sourceLabel: string;
  format: MetricFormat;
  aggregation: string;
  dimensions: string[];
  definition: string;
}

const BREAKDOWN_LABELS: Record<BreakdownType, string> = {
  age: "Age range",
  gender: "Gender",
  country: "Country",
  city: "City or region",
  language: "Language",
  discovery_surface: "Where views came from (Feed, Reels, Explore...)",
  follower_status: "Views from followers vs non-followers",
  follower_status_engagement: "Engagement from followers vs non-followers",
  format_engagement: "Engagement by content format",
  job_function: "Job function",
  seniority: "Seniority",
  industry: "Industry",
  company_size: "Company size",
};

const DEFAULT_BUCKETS: Partial<Record<BreakdownType, string[]>> = {
  age: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"],
  gender: ["Men", "Women"],
  follower_status: ["Non-followers", "Followers"],
  follower_status_engagement: ["Non-followers", "Followers"],
  discovery_surface: ["Feed", "Reels", "Explore", "Search", "Profile", "Other"],
  format_engagement: ["Reels", "Photos", "Link Posts", "Carousels", "Other"],
};

const DIMENSION_LABELS: Record<string, string> = { channel: "Channel", landing_page: "Landing page", product: "Product" };

function lastMonth(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function ManualEntry({
  slug,
  metrics,
  platforms,
  breakdowns,
  demo,
}: {
  slug: string;
  metrics: MetricOption[];
  platforms: { value: DataSource; label: string }[];
  breakdowns: BreakdownType[];
  demo: boolean;
}) {
  const [mode, setMode] = useState<"metric" | "breakdown">("metric");
  const [state, action, pending] = useActionState<ManualState, FormData>(saveManualEntry.bind(null, slug), { status: "idle" });
  const defaults = useMemo(() => lastMonth(), []);

  return (
    <div className="max-w-3xl space-y-6">
      <div role="tablist" aria-label="Entry type" className="inline-flex rounded-lg border border-line bg-surface p-1">
        {(
          [
            ["metric", "A single number"],
            ["breakdown", "Audience breakdown (%)"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition ${mode === id ? "bg-raised text-fg" : "text-fg-secondary hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {state.status === "error" && <Notice tone="error">{state.message}</Notice>}
      {state.status === "done" && <Notice tone="success">{state.message}</Notice>}
      {demo && <Notice tone="info">Demo mode: entries can be filled in but not saved until Supabase is connected.</Notice>}

      <form action={action} className="space-y-5 rounded-xl border border-line bg-surface p-5" key={mode}>
        <input type="hidden" name="mode" value={mode} />
        {mode === "metric" ? <MetricFields metrics={metrics} /> : <BreakdownFields platforms={platforms} breakdowns={breakdowns} />}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={mode === "breakdown" ? "Period start" : "Start date"} htmlFor="periodStart">
            <input id="periodStart" name="periodStart" type="date" required defaultValue={defaults.start} className={inputClass} />
          </Field>
          <Field label={mode === "breakdown" ? "As of (period end)" : "End date"} htmlFor="periodEnd">
            <input id="periodEnd" name="periodEnd" type="date" required defaultValue={defaults.end} className={inputClass} />
          </Field>
        </div>
        <p className="text-xs text-fg-muted">
          {mode === "metric"
            ? "Use the same start and end date for a single day. For follower counts, enter the count on the end date."
            : "Demographics are saved as of the end date. Discovery and format mixes cover the whole period."}
        </p>

        <Button type="submit" disabled={pending || demo}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </form>
    </div>
  );
}

function MetricFields({ metrics }: { metrics: MetricOption[] }) {
  const [key, setKey] = useState(metrics[0]?.key ?? "");
  const metric = metrics.find((m) => m.key === key);
  const groups = useMemo(() => {
    const map = new Map<string, MetricOption[]>();
    for (const m of metrics) map.set(m.sourceLabel, [...(map.get(m.sourceLabel) ?? []), m]);
    return [...map.entries()];
  }, [metrics]);

  if (!metrics.length) return <p className="text-sm text-fg-secondary">Turn on a data source for this client first.</p>;

  return (
    <>
      <Field label="Metric" htmlFor="metric" hint={metric?.definition}>
        <select id="metric" name="metric" value={key} onChange={(e) => setKey(e.target.value)} className={inputClass}>
          {groups.map(([source, items]) => (
            <optgroup key={source} label={source}>
              {items.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field
        label={`Value${metric?.format === "currency" ? " (USD)" : ""}`}
        htmlFor="value"
        hint={metric?.aggregation === "unique" ? "Enter the figure the platform shows for exactly this date range." : undefined}
      >
        <input id="value" name="value" inputMode="decimal" required placeholder="0" className={inputClass} />
      </Field>
      {metric && metric.dimensions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Breakdown (optional)" htmlFor="dimension">
            <select id="dimension" name="dimension" defaultValue="" className={inputClass}>
              <option value="">Total</option>
              {metric.dimensions.map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABELS[d] ?? d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Breakdown value" htmlFor="dimensionValue">
            <input id="dimensionValue" name="dimensionValue" placeholder="e.g. Paid Social" className={inputClass} />
          </Field>
        </div>
      )}
    </>
  );
}

function BreakdownFields({ platforms, breakdowns }: { platforms: { value: DataSource; label: string }[]; breakdowns: BreakdownType[] }) {
  const [type, setType] = useState<BreakdownType>("age");
  const [rows, setRows] = useState<{ bucket: string; share: string }[]>(() => (DEFAULT_BUCKETS.age ?? []).map((b) => ({ bucket: b, share: "" })));
  const total = rows.reduce((s, r) => s + (Number(r.share) || 0), 0);

  function changeType(t: BreakdownType) {
    setType(t);
    setRows((DEFAULT_BUCKETS[t] ?? ["", "", ""]).map((b) => ({ bucket: b, share: "" })));
  }

  if (!platforms.length) return <p className="text-sm text-fg-secondary">Turn on a social platform for this client first.</p>;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Platform" htmlFor="platform">
          <select id="platform" name="platform" className={inputClass}>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Breakdown" htmlFor="breakdownType">
          <select id="breakdownType" name="breakdownType" value={type} onChange={(e) => changeType(e.target.value as BreakdownType)} className={inputClass}>
            {breakdowns.map((b) => (
              <option key={b} value={b}>
                {BREAKDOWN_LABELS[b]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <fieldset>
        <legend className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Shares</legend>
        <p className="mt-1 text-xs text-fg-muted">Leave the percentage blank to skip a row. Saving replaces this breakdown for the chosen date.</p>
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_auto] gap-2">
              <input
                aria-label={`Label ${i + 1}`}
                name="bucket"
                value={r.bucket}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, bucket: e.target.value } : x)))}
                placeholder="Label"
                className={inputClass}
              />
              <div className="relative">
                <input
                  aria-label={`Percent ${i + 1}`}
                  name="share"
                  inputMode="decimal"
                  value={r.share}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, share: e.target.value } : x)))}
                  placeholder="0"
                  className={`${inputClass} pr-7 text-right tabular-nums`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">%</span>
              </div>
              <button
                type="button"
                aria-label={`Remove row ${i + 1}`}
                onClick={() => setRows(rows.filter((_, j) => j !== i))}
                className="rounded-lg px-3 text-fg-muted transition hover:bg-raised hover:text-negative"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between text-sm">
          <button type="button" onClick={() => setRows([...rows, { bucket: "", share: "" }])} className="text-teal hover:text-teal-200">
            + Add row
          </button>
          <span className={`tabular-nums ${total > 100.5 ? "text-negative" : "text-fg-secondary"}`}>Total {total.toFixed(1)}%</span>
        </div>
      </fieldset>
    </>
  );
}
