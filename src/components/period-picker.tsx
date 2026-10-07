"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import type { DateRange } from "@/lib/metrics/aggregate";
import { COMPARE_MODES, PRESETS, periodQuery, type CompareMode, type PresetId } from "@/lib/report/period";

const field =
  "w-full rounded-lg border border-line bg-raised px-3 py-2 text-sm text-fg outline-none transition focus:border-teal disabled:opacity-50";

export interface PeriodPickerProps {
  preset: PresetId;
  range: DateRange;
  label: string;
  rangeLabel: string;
  compareMode: CompareMode;
  compareRange: DateRange | null;
  compareLabel: string | null;
  /** Calendar months to offer, newest first: [YYYY-MM-01, "July 2026"]. */
  months: [string, string][];
  /** Neighboring months for the arrows, when a single month is shown. */
  prevMonth: string | null;
  nextMonth: string | null;
}

/**
 * Date range and comparison controls. Everything lives in the URL, so a view
 * can be bookmarked or sent to someone and opens exactly as it was.
 */
export function PeriodPicker(props: PeriodPickerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [preset, setPreset] = useState<PresetId>(props.preset);
  const [month, setMonth] = useState(props.preset === "month" ? props.range.start : (props.months[0]?.[0] ?? props.range.start));
  const [from, setFrom] = useState(props.range.start);
  const [to, setTo] = useState(props.range.end);
  const [mode, setMode] = useState<CompareMode>(props.compareMode);
  const [cfrom, setCfrom] = useState(props.compareRange?.start ?? "");
  const [cto, setCto] = useState(props.compareRange?.end ?? "");

  // Close on Escape or a click outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const go = (query: string) => {
    setOpen(false);
    startTransition(() => router.push(`?${query}`, { scroll: false }));
  };

  const customOk = from !== "" && to !== "" && to >= from;
  const compareOk = mode !== "custom" || (cfrom !== "" && cto !== "" && cto >= cfrom);
  const canApply = (preset !== "custom" || customOk) && compareOk;

  function apply() {
    if (!canApply) return;
    const range: DateRange =
      preset === "month" ? { start: month, end: month } : preset === "custom" ? { start: from, end: to } : props.range;
    go(periodQuery({ preset, range, compareMode: mode, compareRange: mode === "custom" ? { start: cfrom, end: cto } : null }));
  }

  const keepCompare = { compareMode: props.compareMode, compareRange: props.compareRange };
  const arrow =
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-fg-secondary transition hover:border-line-focus hover:text-fg";

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2">
        {props.prevMonth && (
          <button
            type="button"
            aria-label="Previous month"
            className={arrow}
            onClick={() => go(periodQuery({ preset: "month", range: { start: props.prevMonth!, end: props.prevMonth! }, ...keepCompare }))}
          >
            ←
          </button>
        )}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-2 text-left transition hover:border-line-focus sm:flex-none"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-fg">{props.label}</span>
            <span className="block truncate text-xs text-fg-muted">
              {props.rangeLabel !== props.label && <span className="hidden sm:inline">{props.rangeLabel} · </span>}
              {props.compareLabel ? `vs ${props.compareLabel}` : "No comparison"}
            </span>
          </span>
          <span aria-hidden className={`text-xs text-fg-secondary transition ${open ? "rotate-180" : ""}`}>
            ▼
          </span>
        </button>
        {props.nextMonth && (
          <button
            type="button"
            aria-label="Next month"
            className={arrow}
            onClick={() => go(periodQuery({ preset: "month", range: { start: props.nextMonth!, end: props.nextMonth! }, ...keepCompare }))}
          >
            →
          </button>
        )}
        {pending && <span className="sr-only">Loading</span>}
      </div>

      {open && <div aria-hidden className="fixed inset-0 z-40 bg-page/70 sm:hidden" onClick={() => setOpen(false)} />}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose dates"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-line bg-shell p-5 shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[560px] sm:rounded-2xl"
        >
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <fieldset className="space-y-1.5">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-secondary">Date range</legend>
              <Choice name="preset" checked={preset === "month"} onChange={() => setPreset("month")} label="Calendar month" />
              {preset === "month" && (
                <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} className={`${field} ml-7 w-[calc(100%-1.75rem)]`}>
                  {props.months.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              )}
              {PRESETS.map((p) => (
                <Choice key={p.id} name="preset" checked={preset === p.id} onChange={() => setPreset(p.id)} label={p.label} />
              ))}
              <Choice name="preset" checked={preset === "custom"} onChange={() => setPreset("custom")} label="Custom range" />
              {preset === "custom" && (
                <div className="ml-7 grid grid-cols-2 gap-2">
                  <input aria-label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className={field} />
                  <input aria-label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className={field} />
                </div>
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-secondary">Compare with</legend>
              {COMPARE_MODES.map((m) => (
                <Choice key={m.id} name="compare" checked={mode === m.id} onChange={() => setMode(m.id)} label={m.label} />
              ))}
              {mode === "custom" && (
                <div className="ml-7 grid grid-cols-2 gap-2">
                  <input aria-label="Compare from" type="date" value={cfrom} max={cto || undefined} onChange={(e) => setCfrom(e.target.value)} className={field} />
                  <input aria-label="Compare to" type="date" value={cto} min={cfrom || undefined} onChange={(e) => setCto(e.target.value)} className={field} />
                </div>
              )}
              <p className="pt-2 text-xs leading-relaxed text-fg-muted">
                Previous period means the same length of time just before. A month compares with the month before.
              </p>
            </fieldset>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2 border-t border-line pt-4">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-fg-secondary transition hover:text-fg">
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={!canApply}
              className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-page transition hover:bg-teal-200 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Choice({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm transition hover:bg-raised ${checked ? "text-fg" : "text-fg-secondary"}`}>
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 accent-[var(--color-teal)]" />
      {label}
    </label>
  );
}
