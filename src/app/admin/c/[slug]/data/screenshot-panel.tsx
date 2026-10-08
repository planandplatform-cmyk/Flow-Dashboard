"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import { formatValue } from "@/lib/metrics/format";
import { METRICS } from "@/lib/metrics/config";
import { COMPETITOR_LABELS, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, type CompetitorMetric, type ScreenshotPlatform } from "@/lib/ingest/screenshot";
import type { BreakdownType } from "@/lib/ingest/types";
import { readScreenshotUpload, saveScreenshotUpload, type ScreenshotReadState } from "./screenshot-actions";

const PLATFORMS: { value: ScreenshotPlatform; label: string }[] = [
  { value: "ga4", label: "Google Analytics" },
  { value: "meta_facebook", label: "Facebook" },
  { value: "meta_instagram", label: "Instagram" },
  { value: "meta_ads", label: "Meta Ads" },
  { value: "linkedin", label: "LinkedIn" },
];

const BREAKDOWN_LABELS: Record<BreakdownType, string> = {
  age: "Age",
  gender: "Gender",
  country: "Country",
  city: "City",
  language: "Language",
  discovery_surface: "Views from",
  follower_status: "Follower status (views)",
  follower_status_engagement: "Follower status (engagement)",
  format_engagement: "Engagement by format",
  format_views: "Views by content type",
  job_function: "Job function",
  seniority: "Seniority",
  industry: "Industry",
  company_size: "Company size",
};

const MAX_EDGE = 2576; // the model reads up to this many pixels on the long edge
const KEEP_AS_IS_BYTES = 1_200_000;

interface Shot {
  id: string;
  file: File;
  url: string;
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/**
 * Downscale large screenshots in the browser so uploads stay small and fast.
 * PDFs are sent as they are: the model reads their text and pages directly.
 */
async function prepare(file: File): Promise<File> {
  if (isPdf(file)) return file.type === "application/pdf" ? file : new File([file], file.name, { type: "application/pdf" });
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const okType = ["image/png", "image/jpeg", "image/webp"].includes(file.type);
  if (scale === 1 && okType && file.size <= KEEP_AS_IS_BYTES) {
    bitmap.close();
    return file;
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const toBlob = (type: string, q?: number) => new Promise<Blob | null>((r) => canvas.toBlob(r, type, q));
  let blob = await toBlob("image/png");
  let ext = "png";
  if (!blob || blob.size > KEEP_AS_IS_BYTES) {
    // Screenshots are mostly text; high-quality WebP keeps it sharp at a fraction of the size.
    blob = (await toBlob("image/webp", 0.92)) ?? blob;
    ext = blob?.type === "image/webp" ? "webp" : "png";
  }
  const base = file.name.replace(/\.[^.]+$/, "") || "screenshot";
  return new File([blob!], `${base}.${ext}`, { type: blob!.type });
}

type Ready = Extract<ScreenshotReadState, { status: "ready" }>;
interface Row {
  include: boolean;
  key: string;
  label: string;
  value: string;
  valueText: string;
  labelSeen: string;
  imageIndex: number;
  confidence: "high" | "medium" | "low";
  note: string | null;
}
interface CRow {
  include: boolean;
  company: string;
  own: boolean;
  metric: CompetitorMetric;
  value: string;
  change: string;
  imageIndex: number;
  confidence: "high" | "medium" | "low";
}
interface BRow {
  include: boolean;
  type: BreakdownType;
  bucket: string;
  percent: string;
  imageIndex: number;
  confidence: "high" | "medium" | "low";
}

export function ScreenshotPanel({
  slug,
  clientName,
  configured,
  enabled,
}: {
  slug: string;
  clientName: string;
  configured: boolean;
  enabled: string[];
}) {
  const platforms = PLATFORMS.filter((p) => enabled.includes(p.value));
  const [platform, setPlatform] = useState<ScreenshotPlatform>(platforms[0]?.value ?? "meta_facebook");
  const [shots, setShots] = useState<Shot[]>([]);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [state, readAction, reading] = useActionState<ScreenshotReadState, FormData>(readScreenshotUpload.bind(null, slug), { status: "idle" });
  const [, startRead] = useTransition();
  const [saving, startSave] = useTransition();
  const [saved, setSaved] = useState<{ inserted: number; updated: number } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);

  async function addFiles(files: File[]) {
    setPrepError(null);
    const usable = files.filter((f) => f.type.startsWith("image/") || isPdf(f));
    if (usable.length < files.length) setPrepError("Only screenshots and PDFs can be added here. Use the Upload a file tab for CSV and Excel exports.");
    const tooBig = usable.filter((f) => isPdf(f) && f.size > MAX_SCREENSHOT_BYTES);
    if (tooBig.length) setPrepError(`${tooBig[0].name} is over 3.5 MB. Save only the pages with the numbers, or export a smaller PDF.`);
    const accepted = usable.filter((f) => !tooBig.includes(f));
    const room = MAX_SCREENSHOTS - shots.length;
    if (accepted.length > room) setPrepError(`Up to ${MAX_SCREENSHOTS} files at a time.`);
    try {
      const prepared = await Promise.all(accepted.slice(0, Math.max(0, room)).map(prepare));
      setShots((s) => [...s, ...prepared.map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }))]);
    } catch {
      setPrepError("One of the files could not be opened.");
    }
  }

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void addFiles(files.map((f, i) => new File([f], f.name || `pasted-${Date.now()}-${i}.png`, { type: f.type })));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  function imagesForm(): FormData {
    const fd = new FormData();
    for (const s of shots) fd.append("images", s.file);
    return fd;
  }

  function read() {
    const fd = imagesForm();
    fd.set("platform", platform);
    if (periodStart || periodEnd) {
      fd.set("periodStart", periodStart);
      fd.set("periodEnd", periodEnd);
    }
    setSaved(null);
    setSaveError(null);
    startRead(() => readAction(fd));
  }

  function removeShot(id: string) {
    setShots((s) => s.filter((x) => x.id !== id));
  }

  if (!platforms.length) {
    return <Notice tone="info">{clientName} has no Google Analytics, Facebook, Instagram, Meta Ads or LinkedIn channel turned on. Turn one on in Settings to read screenshots and PDFs.</Notice>;
  }

  if (!configured) {
    return (
      <Notice tone="info" title="Screenshot and PDF reading is not set up yet">
        Add an Anthropic API key as <code>ANTHROPIC_API_KEY</code> in the Vercel environment variables (and in <code>.env.local</code> for local
        development), then reload this page.
      </Notice>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
      <div className="space-y-5 self-start rounded-xl border border-line bg-surface p-5">
        <Field label="Platform" htmlFor="shot-platform">
          <select id="shot-platform" value={platform} onChange={(e) => setPlatform(e.target.value as ScreenshotPlatform)} className={inputClass}>
            {platforms.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label={`Screenshots or PDFs (${shots.length}/${MAX_SCREENSHOTS})`} htmlFor="shot-files" hint="Drop files here, choose them, or paste screenshots with Ctrl+V / Cmd+V.">
          <label
            htmlFor="shot-files"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addFiles([...e.dataTransfer.files]);
            }}
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-line bg-raised px-4 py-6 text-center transition hover:border-teal"
          >
            <span className="text-sm font-medium text-fg">Add screenshots or PDFs</span>
            <span className="mt-1 text-xs text-fg-muted">PNG, JPEG, WebP or PDF</span>
          </label>
          <input
            id="shot-files"
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
            className="sr-only"
            onChange={(e) => {
              void addFiles([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </Field>

        {shots.length > 0 && (
          <ul className="grid grid-cols-3 gap-2">
            {shots.map((s, i) => (
              <li key={s.id} className="group relative overflow-hidden rounded-md border border-line bg-raised">
                {isPdf(s.file) ? (
                  <div className="flex h-20 flex-col items-center justify-center gap-1 px-1 text-center">
                    <span className="rounded border border-teal-800 bg-teal-950 px-1.5 text-xs font-semibold text-teal">PDF</span>
                    <span className="w-full truncate text-xs text-fg-muted" title={s.file.name}>{s.file.name}</span>
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={s.url} alt={`Screenshot ${i + 1}`} className="h-20 w-full object-cover object-top" />
                )}
                <span className="absolute left-1 top-1 rounded bg-page/80 px-1.5 text-xs text-fg">{i + 1}</span>
                <button
                  type="button"
                  onClick={() => removeShot(s.id)}
                  aria-label={`Remove file ${i + 1}`}
                  className="absolute right-1 top-1 rounded bg-page/80 px-1.5 text-xs text-fg-secondary hover:text-negative"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        {prepError && <p className="text-sm text-negative">{prepError}</p>}

        <fieldset className="space-y-3">
          <legend className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Dates covered</legend>
          <p className="text-xs text-fg-muted">Only needed if the files show something like &quot;Last 28 days&quot; instead of exact dates.</p>
          <div className="grid grid-cols-2 gap-3">
            <input aria-label="Start date" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputClass} />
            <input aria-label="End date" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputClass} />
          </div>
        </fieldset>

        <Button type="button" onClick={read} disabled={reading || saving || shots.length === 0} className="w-full">
          {reading ? "Reading..." : "Read numbers"}
        </Button>
        <p className="text-xs text-fg-muted">AI reads the numbers; you check every value before anything is saved.</p>
      </div>

      <div className="min-w-0 space-y-6" aria-live="polite">
        {state.status === "idle" && !reading && (
          <div className="rounded-xl border border-dashed border-line p-8 text-sm leading-relaxed text-fg-secondary">
            <p className="font-medium text-fg">Tips for files that read well</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li>Set the date range in the platform first, and keep the dates visible in the screenshot.</li>
              <li>Hover off charts so tooltips do not cover numbers.</li>
              <li>Exact numbers beat rounded ones (21,239 rather than 21.2K). Open the detail view when the platform rounds.</li>
              <li>PDFs work too: a GA4 or Meta report export, or a platform page saved as PDF. Keep them under 3.5 MB.</li>
              <li>One platform per batch. Up to {MAX_SCREENSHOTS} files at a time.</li>
            </ul>
          </div>
        )}
        {reading && <Notice tone="info">Reading {shots.length} file{shots.length === 1 ? "" : "s"}. This usually takes 15 to 60 seconds.</Notice>}
        {state.status === "error" && !reading && <Notice tone="error">{state.message}</Notice>}
        {saved && (
          <Notice tone="success" title="Saved">
            {saved.inserted} new and {saved.updated} updated values are now in {clientName}&apos;s report.{" "}
            <Link href={`/c/${slug}`} className="underline">View report</Link> · <Link href="?tab=history" className="underline">Upload history</Link>
          </Notice>
        )}
        {state.status === "ready" && !reading && !saved && (
          <Review
            key={JSON.stringify(state.items) + state.period?.start}
            state={state}
            shots={shots}
            saving={saving}
            saveError={saveError}
            onSave={(reviewed) => {
              const fd = imagesForm();
              fd.set("reviewed", JSON.stringify(reviewed));
              setSaveError(null);
              startSave(async () => {
                const res = await saveScreenshotUpload(slug, fd);
                if (res.status === "done") {
                  setSaved(res);
                  setShots([]);
                } else setSaveError(res.message);
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

const CONFIDENCE = {
  high: "border-teal-800 bg-teal-950 text-teal",
  medium: "border-line bg-raised text-fg-secondary",
  low: "border-negative/40 bg-negative/10 text-negative",
};

function Review({
  state,
  shots,
  saving,
  saveError,
  onSave,
}: {
  state: Ready;
  shots: Shot[];
  saving: boolean;
  saveError: string | null;
  onSave: (reviewed: unknown) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => state.items.map((i) => ({ ...i, include: true, value: String(i.value) })));
  const [brows, setBrows] = useState<BRow[]>(() => state.breakdowns.map((b) => ({ ...b, include: true, percent: String(b.percent) })));
  const [crows, setCrows] = useState<CRow[]>(() =>
    state.competitors.map((c) => ({ ...c, include: true, value: String(c.value), change: c.change === null ? "" : String(c.change) })),
  );
  const [start, setStart] = useState(state.period?.start ?? "");
  const [end, setEnd] = useState(state.period?.end ?? "");
  const [campaign, setCampaign] = useState(state.campaignName ?? "");
  const [zoom, setZoom] = useState<number | null>(null);

  const included = rows.filter((r) => r.include);
  const badNumber = included.some((r) => r.value.trim() === "" || !Number.isFinite(Number(r.value.replace(/,/g, ""))));
  const datesOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && end >= start;
  const blocking = state.errors.filter((e) => !/dates|date range/i.test(e) || !datesOk);
  const existing = state.overlap ? Object.values(state.overlap).reduce((s, o) => s + o.existing, 0) : 0;

  function save() {
    onSave({
      platform: state.platform,
      period: { start, end },
      campaignName: campaign || null,
      metrics: included.map((r) => ({ key: r.key, value: Number(r.value.replace(/,/g, "")) })),
      breakdowns: brows.filter((b) => b.include).map((b) => ({ type: b.type, bucket: b.bucket, percent: Number(b.percent) })),
      competitors: crows
        .filter((c) => c.include)
        .map((c) => ({ company: c.company, own: c.own, metric: c.metric, value: Number(c.value.replace(/,/g, "")), change: c.change.trim() === "" ? null : Number(c.change.replace(/[%+]/g, "")) })),
    });
  }

  return (
    <div className="space-y-6">
      {blocking.length > 0 && (
        <Notice tone="error" title="Fix before saving">
          <ul className="list-disc space-y-1 pl-5">
            {blocking.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </Notice>
      )}
      {state.warnings.length > 0 && (
        <Notice tone="warning" title="Check before saving">
          <ul className="list-disc space-y-1 pl-5">
            {state.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </Notice>
      )}

      <div className="rounded-xl border border-line bg-surface p-5">
        <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Dates these numbers cover</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:max-w-md">
          <input aria-label="Start date" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
          <input aria-label="End date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
        </div>
        {state.platform === "meta_ads" && (
          <div className="mt-4 sm:max-w-md">
            <Field label="Campaign name" htmlFor="campaign" hint="Shown in the report's ad section. Leave blank for account totals.">
              <input id="campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)} className={inputClass} />
            </Field>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
              Numbers read. Correct anything that does not match the original; untick to leave a number out.
            </caption>
            <thead className="bg-raised">
              <tr>
                {["", "Metric", "Value to save", "As shown", "Confidence", "File"].map((h, i) => (
                  <th key={i} scope="col" className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-surface">
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-line align-top ${r.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Include ${r.label}`}
                      checked={r.include}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      className="h-4 w-4 accent-[var(--color-teal)]"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <div className="text-fg">{r.label}</div>
                    <div className="text-xs text-fg-muted">&quot;{r.labelSeen}&quot;</div>
                    {r.note && <div className="mt-1 text-xs text-negative">{r.note}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`${r.label} value`}
                      inputMode="decimal"
                      value={r.value}
                      onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                      className={`${inputClass} w-32 text-right tabular-nums`}
                    />
                    {METRICS[r.key] && Number.isFinite(Number(r.value)) && (
                      <div className="mt-1 text-right text-xs text-fg-muted">{formatValue(Number(r.value), METRICS[r.key].format)}</div>
                    )}
                  </td>
                  <td className="px-3 py-3 tabular-nums text-fg-secondary">{r.valueText}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${CONFIDENCE[r.confidence]}`}>{r.confidence}</span>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => setZoom(r.imageIndex)} className="text-teal hover:text-teal-200">
                      #{r.imageIndex}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {brows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
              Audience shares read
            </caption>
            <thead className="bg-raised">
              <tr>
                {["", "Breakdown", "Label", "Percent", "File"].map((h, i) => (
                  <th key={i} scope="col" className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-surface">
              {brows.map((b, i) => (
                <tr key={i} className={`border-t border-line ${b.include ? "" : "opacity-50"}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={`Include ${b.bucket}`}
                      checked={b.include}
                      onChange={(e) => setBrows(brows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      className="h-4 w-4 accent-[var(--color-teal)]"
                    />
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{BREAKDOWN_LABELS[b.type]}</td>
                  <td className="px-3 py-2">
                    <input
                      aria-label="Label"
                      value={b.bucket}
                      onChange={(e) => setBrows(brows.map((x, j) => (j === i ? { ...x, bucket: e.target.value } : x)))}
                      className={inputClass}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      aria-label={`${b.bucket} percent`}
                      inputMode="decimal"
                      value={b.percent}
                      onChange={(e) => setBrows(brows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))}
                      className={`${inputClass} w-24 text-right tabular-nums`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => setZoom(b.imageIndex)} className="text-teal hover:text-teal-200">
                      #{b.imageIndex}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {crows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="bg-raised px-4 pt-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
              LinkedIn competitor comparison read
            </caption>
            <thead className="bg-raised">
              <tr>
                {["", "Company", "Your page", "Measure", "Value", "Change %", "File"].map((h, i) => (
                  <th key={i} scope="col" className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-surface">
              {crows.map((c, i) => {
                const set = (patch: Partial<CRow>) => setCrows(crows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <tr key={i} className={`border-t border-line ${c.include ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`Include ${c.company}`} checked={c.include} onChange={(e) => set({ include: e.target.checked })} className="h-4 w-4 accent-[var(--color-teal)]" />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label="Company" value={c.company} onChange={(e) => set({ company: e.target.value })} className={inputClass} />
                    </td>
                    <td className="px-3 py-2">
                      <input type="checkbox" aria-label={`${c.company} is your page`} checked={c.own} onChange={(e) => set({ own: e.target.checked })} className="h-4 w-4 accent-[var(--color-teal)]" />
                    </td>
                    <td className="px-3 py-2 text-fg-secondary">{COMPETITOR_LABELS[c.metric]}</td>
                    <td className="px-3 py-2">
                      <input aria-label={`${c.company} value`} inputMode="decimal" value={c.value} onChange={(e) => set({ value: e.target.value })} className={`${inputClass} w-24 text-right tabular-nums`} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label={`${c.company} change`} inputMode="decimal" placeholder="None" value={c.change} onChange={(e) => set({ change: e.target.value })} className={`${inputClass} w-24 text-right tabular-nums`} />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" onClick={() => setZoom(c.imageIndex)} className="text-teal hover:text-teal-200">
                        #{c.imageIndex}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {zoom !== null && shots[zoom - 1] && (
        <figure className="rounded-xl border border-line bg-surface p-3">
          <figcaption className="mb-2 flex items-center justify-between text-xs text-fg-secondary">
            {isPdf(shots[zoom - 1].file) ? shots[zoom - 1].file.name : `Screenshot ${zoom}`}
            <button type="button" onClick={() => setZoom(null)} className="text-fg-secondary hover:text-fg">
              Close
            </button>
          </figcaption>
          {isPdf(shots[zoom - 1].file) ? (
            <object data={shots[zoom - 1].url} type="application/pdf" className="h-[70vh] w-full rounded-md">
              <a href={shots[zoom - 1].url} target="_blank" rel="noreferrer" className="text-teal underline">
                Open the PDF
              </a>
            </object>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shots[zoom - 1].url} alt={`Screenshot ${zoom}`} className="w-full rounded-md" />
          )}
        </figure>
      )}

      <div className="rounded-xl border border-line bg-surface p-5 text-sm text-fg-secondary">
        {state.demo
          ? "Demo mode: connect Supabase to save."
          : state.overlap
            ? existing === 0
              ? "All of this is new data. Nothing will be overwritten."
              : `${existing} values already exist for these dates and will be replaced.`
            : null}
      </div>

      {saveError && <Notice tone="error">{saveError}</Notice>}
      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={save} disabled={saving || state.demo || badNumber || !datesOk || blocking.length > 0 || (included.length === 0 && !brows.some((b) => b.include) && !crows.some((c) => c.include))}>
          {saving ? "Saving..." : "Save checked values"}
        </Button>
        {badNumber && <span className="self-center text-sm text-negative">Every ticked value needs a number.</span>}
        {!datesOk && <span className="self-center text-sm text-negative">Enter the dates these numbers cover.</span>}
      </div>
    </div>
  );
}
