import type { Comparison } from "@/lib/metrics/aggregate";
import { formatDelta, formatMetric, formatPctChange } from "@/lib/metrics/format";
import { MetricLabel } from "./info-tip";

export function DeltaBadge({
  metricKey,
  comparison,
  showDelta = true,
}: {
  metricKey: string;
  comparison: Comparison | null;
  showDelta?: boolean;
}) {
  if (!comparison || comparison.direction === null) return null;
  const tone =
    comparison.sentiment === "positive"
      ? "text-positive bg-positive/10 border-positive/30"
      : comparison.sentiment === "negative"
        ? "text-negative bg-negative/10 border-negative/30"
        : "text-fg-secondary bg-raised border-line";
  const arrow = comparison.direction === "up" ? "▲" : comparison.direction === "down" ? "▼" : "";
  const pct = comparison.pctChange === null ? "New" : formatPctChange(comparison.pctChange);
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums ${tone}`}>
      {arrow && <span aria-hidden className="text-[9px]">{arrow}</span>}
      <span>{pct}</span>
      {showDelta && comparison.delta !== null && comparison.delta !== 0 && (
        <span className="text-fg-secondary">({formatDelta(metricKey, comparison.delta)})</span>
      )}
    </span>
  );
}

/**
 * Large month-over-month change, ticker style: green when the change is good
 * news, red when it is bad news. The arrow shows the direction, so a cost that
 * went up reads as a red up arrow.
 */
export function BigDelta({ comparison }: { comparison: Comparison }) {
  if (comparison.direction === null) return <p className="text-3xl font-semibold text-fg-muted">N/A</p>;
  const color =
    comparison.sentiment === "positive" ? "text-positive" : comparison.sentiment === "negative" ? "text-negative" : "text-fg-secondary";
  const arrow = comparison.direction === "up" ? "\u25B2" : comparison.direction === "down" ? "\u25BC" : "";
  const label =
    comparison.direction === "up" ? "Increase" : comparison.direction === "down" ? "Decrease" : "No change";
  return (
    <p className={`flex items-center gap-2 text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl ${color}`}>
      {arrow && (
        <span aria-hidden className="text-lg sm:text-xl">
          {arrow}
        </span>
      )}
      <span>{comparison.pctChange === null ? "New" : formatPctChange(comparison.pctChange)}</span>
      <span className="sr-only">{label}</span>
    </p>
  );
}

/**
 * KPI tile in the report style: thin teal bar on top, large teal number,
 * small uppercase gray label, change versus the comparison period.
 */
export function KpiTile({
  metricKey,
  value,
  comparison,
  label,
  caption,
  estimated,
  size = "md",
}: {
  metricKey: string;
  value: number | null;
  comparison?: Comparison | null;
  label?: string;
  caption?: string;
  estimated?: boolean;
  size?: "md" | "lg";
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-5 transition hover:border-line-focus">
      <div aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-teal via-teal-600 to-teal-800" />
      <div
        className={`font-semibold tabular-nums tracking-tight text-teal ${size === "lg" ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl"}`}
      >
        {formatMetric(metricKey, value)}
        {estimated && (
          <span className="ml-1 align-top text-xs font-normal text-fg-muted" title="Estimated for this date range">
            est.
          </span>
        )}
      </div>
      <MetricLabel
        metricKey={metricKey}
        label={label}
        className="mt-2 block text-xs font-medium uppercase tracking-wider text-fg-secondary"
      />
      {caption && <p className="mt-1 text-xs text-fg-muted">{caption}</p>}
      {comparison && (
        <div className="mt-3">
          <DeltaBadge metricKey={metricKey} comparison={comparison} />
        </div>
      )}
    </div>
  );
}
