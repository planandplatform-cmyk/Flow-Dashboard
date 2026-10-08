import { METRICS } from "./config";
import type { MetricFormat } from "./types";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactish = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const currencyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatValue(value: number | null | undefined, format: MetricFormat): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  switch (format) {
    case "number":
      return Number.isInteger(value) ? integer.format(value) : compactish.format(value);
    case "percent": {
      // Small rates like CTR need two decimals (2.18%); larger ones read better with one.
      const pct = value * 100;
      return `${Math.abs(pct) < 10 ? pct.toFixed(2) : compactish.format(pct)}%`;
    }
    case "currency":
      return Math.abs(value) >= 10_000 ? currencyWhole.format(value) : currency.format(value);
    case "multiplier":
      return `${value.toFixed(2)}x`;
    case "duration": {
      const minutes = Math.round(value);
      const h = Math.floor(Math.abs(minutes) / 60);
      const m = Math.abs(minutes) % 60;
      return `${minutes < 0 ? "-" : ""}${h ? `${h}h ${m}m` : `${m}m`}`;
    }
  }
}

export function formatMetric(key: string, value: number | null | undefined): string {
  return formatValue(value, METRICS[key]?.format ?? "number");
}

/** +5,800% / -12.4% style label for a fractional change. */
export function formatPctChange(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "N/A";
  const abs = Math.abs(pct * 100);
  const digits = abs >= 100 ? 0 : 1;
  const body = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(abs);
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${body}%`;
}

/**
 * +3 / -1,204 / +$12.50 style label for an absolute change. Changes in a
 * rate are percentage points ("+36.7 pts"), not percent.
 */
export function formatDelta(key: string, delta: number | null | undefined): string {
  if (delta === null || delta === undefined) return "N/A";
  const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
  if (METRICS[key]?.format === "percent") {
    const pts = Math.abs(delta * 100);
    return `${sign}${pts < 10 ? pts.toFixed(2) : compactish.format(pts)} pts`;
  }
  return `${sign}${formatMetric(key, Math.abs(delta))}`;
}
