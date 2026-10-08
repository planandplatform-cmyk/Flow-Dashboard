"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import { COMPETITOR_LABELS } from "@/lib/ingest/screenshot";
import { formatValue } from "@/lib/metrics/format";
import { METRICS } from "@/lib/metrics/config";
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { readReportUpload, saveReportUpload, type ReportReadState, type ReportSaveResult } from "./report-actions";

type Ready = Extract<ReportReadState, { status: "ready" }>;

const DIMENSIONS: Record<string, string> = { channel: "by channel", landing_page: "by page" };

/**
 * A complete past report (website, social, ads in one PDF): AI reads every
 * section, the numbers are shown grouped by platform for checking, and save
 * files each platform's numbers under the report's month.
 */
export function ReportImport({ slug, clientName }: { slug: string; clientName: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [state, readAction, reading] = useActionState<ReportReadState, FormData>(readReportUpload.bind(null, slug), { status: "idle" });
  const [, startRead] = useTransition();
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState<Extract<ReportSaveResult, { status: "done" }> | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function read() {
    if (!file) return;
    const fd = new FormData();
    fd.append("images", file);
    if (periodStart || periodEnd) {
      fd.set("periodStart", periodStart);
      fd.set("periodEnd", periodEnd);
    }
    setSaved(null);
    setSaveError(null);
    startRead(() => readAction(fd));
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
      <div className="space-y-5 self-start rounded-xl border border-line bg-surface p-5">
        <Field label="Report file" htmlFor="report-file" hint="A complete monthly report as a PDF, up to 3.5 MB.">
          <label
            htmlFor="report-file"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setFile(f);
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-raised px-4 py-6 text-center transition hover:border-teal"
          >
            <span className="text-sm font-medium text-fg">{file ? file.name : "Add the report PDF"}</span>
            <span className="mt-1 text-xs text-fg-muted">{file ? `${(file.size / 1_000_000).toFixed(1)} MB` : "Drop it here or choose it"}</span>
          </label>
          <input
            id="report-file"
            type="file"
            accept="application/pdf,.pdf,image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </Field>
        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Month covered</legend>
          <p className="text-xs text-fg-muted">Only needed if the report does not print its dates.</p>
          <div className="grid grid-cols-2 gap-3">
            <input aria-label="Start date" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
            <input aria-label="End date" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
          </div>
        </fieldset>
        <Button type="button" onClick={read} disabled={reading || saving || !file} className="w-full">
          {reading ? "Reading the report..." : "Read report"}
        </Button>
        <p className="text-xs text-fg-muted">AI reads every section; you check the numbers before anything is saved.</p>
      </div>

      <div className="min-w-0 space-y-6" aria-live="polite">
        {state.status === "idle" && !reading && (
          <div className="rounded-xl border border-dashed border-line p-8 text-sm leading-relaxed text-fg-secondary">
            <p className="font-medium text-fg">Import a past report</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Drop in a finished monthly report covering website, social and ads. Numbers are filed under each platform for that month.</li>
              <li>Only {clientName}&apos;s turned-on channels are read. Rates and percent changes are skipped; the portal calculates them.</li>
              <li>The report&apos;s own summary can be saved as that month&apos;s commentary, as a draft.</li>
              <li>Uploading the same month again replaces the earlier numbers, so it is safe to redo.</li>
            </ul>
          </div>
        )}
        {reading && <Notice tone="info">Reading the whole report. This can take one to three minutes for a long report.</Notice>}
        {state.status === "error" && !reading && <Notice tone="error">{state.message}</Notice>}
        {saved && (
          <Notice tone="success" title="Saved">
            {saved.saved.map((s) => `${s.platform}: ${s.inserted} new, ${s.updated} updated`).join(" · ")}.
            {saved.commentary === "saved" && " The report's summary was saved as a commentary draft."}
            {saved.commentary === "kept" && " Commentary already existed for that month, so it was left as it was."}{" "}
            <Link href={`/c/${slug}`} className="underline">View report</Link> · <Link href="?tab=history" className="underline">Upload history</Link>
          </Notice>
        )}
        {state.status === "ready" && !reading && !saved && (
          <Review
            key={JSON.stringify(state.items.length) + state.period?.start}
            state={state}
            saving={saving}
            saveError={saveError}
            onSave={(reviewed, importCommentary) => {
              const fd = new FormData();
              if (file) fd.append("images", file);
              fd.set("reviewed", JSON.stringify(reviewed));
              if (importCommentary) fd.set("importCommentary", "1");
              setSaveError(null);
              startSave(async () => {
                const res = await saveReportUpload(slug, fd);
                if (res.status === "done") setSaved(res);
                else setSaveError(res.message);
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

const th = "px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary";

function Review({
  state,
  saving,
  saveError,
  onSave,
}: {
  state: Ready;
  saving: boolean;
  saveError: string | null;
  onSave: (reviewed: unknown, importCommentary: boolean) => void;
}) {
  const [rows, setRows] = useState(() => state.items.map((i) => ({ ...i, include: true, value: String(i.value) })));
  const [tables, setTables] = useState(() => state.tableRows.map((t) => ({ ...t, include: true, value: String(t.value) })));
  const [brows, setBrows] = useState(() => state.breakdowns.map((b) => ({ ...b, include: true, percent: String(b.percent) })));
  const [crows, setCrows] = useState(() => state.competitors.map((c) => ({ ...c, include: true, value: String(c.value), change: c.change === null ? "" : String(c.change) })));
  const [start, setStart] = useState(state.period?.start ?? "");
  const [end, setEnd] = useState(state.period?.end ?? "");
  const [importCommentary, setImportCommentary] = useState(state.hasCommentary);

  const num = (v: string) => Number(v.replace(/[,%+]/g, ""));
  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start;
  const bad = [...rows, ...tables].some((r) => r.include && (r.value.trim() === "" || !Number.isFinite(num(r.value))));
  const blocking = state.errors.filter((e) => !/dates|date range/i.test(e) || !datesOk);
  const nothing = ![...rows, ...tables, ...brows, ...crows].some((r) => r.include);
  const platformsSeen = [...new Set(rows.map((r) => r.source))];

  function save() {
    onSave(
      {
        period: { start, end },
        metrics: rows.filter((r) => r.include).map((r) => ({ source: r.source, key: r.key, value: num(r.value) })),
        tableRows: tables.filter((t) => t.include).map((t) => ({ key: t.key, dimension: t.dimension, bucket: t.bucket, value: num(t.value) })),
        breakdowns: brows.filter((b) => b.include).map((b) => ({ platform: b.platform, type: b.type, bucket: b.bucket, percent: num(b.percent) })),
        competitors: crows
          .filter((c) => c.include)
          .map((c) => ({ company: c.company, own: c.own, metric: c.metric, value: num(c.value), change: c.change.trim() === "" ? null : num(c.change) })),
        commentary: importCommentary ? state.commentary : null,
      },
      importCommentary,
    );
  }

  return (
    <div className="space-y-6">
      {blocking.length > 0 && (
        <Notice tone="error" title="Fix before saving">
          <ul className="list-disc space-y-1 pl-5">{blocking.map((e) => <li key={e}>{e}</li>)}</ul>
        </Notice>
      )}
      {state.warnings.length > 0 && (
        <Notice tone="warning" title="Check before saving">
          <ul className="list-disc space-y-1 pl-5">{state.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Notice>
      )}

      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Month these numbers cover</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <input aria-label="Start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          <input aria-label="End date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </div>
        <p className="mt-3 text-xs text-fg-muted">
          Found: {platformsSeen.map((p) => SOURCE_LABELS[p]).join(", ") || "no platform totals"}
          {tables.length ? ` · ${tables.length} website table rows` : ""}
          {brows.length ? ` · ${brows.length} audience shares` : ""}
          {crows.length ? ` · ${crows.length} competitor values` : ""}
        </p>
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
              Totals read. Correct anything that does not match the report; untick to leave a number out.
            </caption>
            <thead className="bg-raised">
              <tr>{["", "Platform", "Metric", "Value to save", "As printed", "Page"].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="bg-surface">
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-line align-top ${r.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" aria-label={`Include ${r.label}`} checked={r.include} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--color-teal)]" />
                  </td>
                  <td className="px-3 py-3 text-fg-secondary">{SOURCE_LABELS[r.source]}</td>
                  <td className="px-3 py-3">
                    <div className="text-fg">{r.label}</div>
                    <div className="text-xs text-fg-muted">&quot;{r.labelSeen}&quot;</div>
                    {r.note && <div className="mt-1 text-xs text-negative">{r.note}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <input aria-label={`${r.label} value`} inputMode="decimal" value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={`${inputClass} w-32 text-right tabular-nums`} />
                    {METRICS[r.key] && Number.isFinite(num(r.value)) && <div className="mt-1 text-right text-xs text-fg-muted">{formatValue(num(r.value), METRICS[r.key].format)}</div>}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-fg-secondary">{r.valueText}</td>
                  <td className="px-3 py-3 text-fg-muted">p. {r.imageIndex}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tables.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">Website tables read</caption>
            <thead className="bg-raised">
              <tr>{["", "Table", "Row", "Value", "Page"].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="bg-surface">
              {tables.map((t, i) => (
                <tr key={i} className={`border-t border-line ${t.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Include ${t.bucket}`} checked={t.include} onChange={(e) => setTables(tables.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--color-teal)]" />
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{METRICS[t.key]?.label} {DIMENSIONS[t.dimension]}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg">{t.bucket}</td>
                  <td className="px-3 py-2">
                    <input aria-label={`${t.bucket} value`} inputMode="decimal" value={t.value} onChange={(e) => setTables(tables.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={`${inputClass} w-24 text-right tabular-nums`} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">p. {t.page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {brows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">Audience shares read</caption>
            <thead className="bg-raised">
              <tr>{["", "Platform", "Breakdown", "Label", "Percent"].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="bg-surface">
              {brows.map((b, i) => (
                <tr key={i} className={`border-t border-line ${b.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Include ${b.bucket}`} checked={b.include} onChange={(e) => setBrows(brows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--color-teal)]" />
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{SOURCE_LABELS[b.platform]}</td>
                  <td className="px-3 py-2 text-fg-secondary">{b.type.replace(/_/g, " ")}</td>
                  <td className="px-3 py-2 text-fg">{b.bucket}</td>
                  <td className="px-3 py-2">
                    <input aria-label={`${b.bucket} percent`} inputMode="decimal" value={b.percent} onChange={(e) => setBrows(brows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} className={`${inputClass} w-24 text-right tabular-nums`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">LinkedIn competitor comparison read</caption>
            <thead className="bg-raised">
              <tr>{["", "Company", "Measure", "Value", "Change %"].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr>
            </thead>
            <tbody className="bg-surface">
              {crows.map((c, i) => (
                <tr key={i} className={`border-t border-line ${c.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" aria-label={`Include ${c.company}`} checked={c.include} onChange={(e) => setCrows(crows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))} className="h-4 w-4 accent-[var(--color-teal)]" />
                  </td>
                  <td className="px-3 py-2 text-fg">
                    {c.company}
                    {c.own && <span className="ml-2 rounded border border-teal-800 bg-teal-950 px-1.5 text-[11px] text-teal">Your Page</span>}
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{COMPETITOR_LABELS[c.metric]}</td>
                  <td className="px-3 py-2">
                    <input aria-label={`${c.company} value`} inputMode="decimal" value={c.value} onChange={(e) => setCrows(crows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className={`${inputClass} w-24 text-right tabular-nums`} />
                  </td>
                  <td className="px-3 py-2">
                    <input aria-label={`${c.company} change`} inputMode="decimal" placeholder="None" value={c.change} onChange={(e) => setCrows(crows.map((x, j) => (j === i ? { ...x, change: e.target.value } : x)))} className={`${inputClass} w-24 text-right tabular-nums`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.hasCommentary && state.commentary && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={importCommentary} onChange={(e) => setImportCommentary(e.target.checked)} className="mt-1 h-4 w-4 accent-[var(--color-teal)]" />
            <span>
              <span className="block text-sm font-medium text-fg">Save the report&apos;s summary as this month&apos;s commentary (draft)</span>
              <span className="block text-xs text-fg-muted">Only if the month has no commentary yet. You can edit and publish it on the Commentary tab.</span>
            </span>
          </label>
          {state.commentary.headline && <p className="mt-4 font-semibold text-fg">{state.commentary.headline}</p>}
          {state.commentary.summary && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-fg-secondary">{state.commentary.summary}</p>}
        </div>
      )}

      {saveError && <Notice tone="error">{saveError}</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={save} disabled={saving || state.demo || bad || !datesOk || blocking.length > 0 || nothing}>
          {saving ? "Saving..." : "Save checked values"}
        </Button>
        {state.demo && <span className="text-sm text-fg-muted">Demo mode: connect Supabase to save.</span>}
        {bad && <span className="text-sm text-negative">Every ticked value needs a number.</span>}
        {!datesOk && <span className="text-sm text-negative">Enter the dates these numbers cover.</span>}
      </div>
    </div>
  );
}
