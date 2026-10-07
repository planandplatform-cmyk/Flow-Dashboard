"use client";

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatValue } from "@/lib/metrics/format";
import type { MetricFormat } from "@/lib/metrics/types";
import type { TrendPoint, TrendSeries } from "@/lib/report/trends";
import { MetricLabel } from "./info-tip";

export interface ChartAnnotation {
  month: string;
  date: string;
  label: string;
}

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function axisValue(value: number, format: MetricFormat): string {
  if (format === "percent") return `${Math.round(value * 100)}%`;
  if (format === "currency") return `$${compactNumber.format(value)}`;
  if (format === "multiplier") return `${value.toFixed(1)}x`;
  return compactNumber.format(value);
}

/**
 * Twelve-month trend charts, one per key metric. The selected range's months
 * are in core teal; the same months a year earlier are a dashed deeper teal.
 * Annotated events show as teal markers on every chart.
 */
export function TrendCharts({
  series,
  annotations,
  groups,
}: {
  series: TrendSeries[];
  annotations: ChartAnnotation[];
  /** Filter chips: label and the series keys in that group. */
  groups: { id: string; label: string; keys: string[] }[];
}) {
  const [kind, setKind] = useState<"line" | "bar">("line");
  const [group, setGroup] = useState("all");
  const active = groups.find((g) => g.id === group);
  const shown = active ? series.filter((s) => active.keys.includes(s.key)) : series;
  const hasPrevious = series.some((s) => s.points.some((p) => p.previous !== null));

  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
      on ? "border-teal bg-teal-950 text-teal" : "border-line bg-surface text-fg-secondary hover:border-line-focus hover:text-fg"
    }`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Show metrics for">
          <button type="button" className={chip(group === "all")} aria-pressed={group === "all"} onClick={() => setGroup("all")}>
            All
          </button>
          {groups.map((g) => (
            <button key={g.id} type="button" className={chip(group === g.id)} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-line bg-surface p-0.5 text-xs" role="group" aria-label="Chart type">
          {(["line", "bar"] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
              className={`rounded-md px-3 py-1.5 font-medium capitalize transition ${kind === k ? "bg-raised text-fg" : "text-fg-secondary hover:text-fg"}`}
            >
              {k}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-fg-secondary">
        <span className="flex items-center gap-2">
          <span aria-hidden className="h-0.5 w-5 rounded bg-teal" /> Selected months
        </span>
        {hasPrevious && (
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-5 border-t-2 border-dashed border-teal-700" /> Same month last year
          </span>
        )}
        {annotations.length > 0 && (
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-teal" /> Event
          </span>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        {shown.map((s) => (
          <TrendCard key={s.key} series={s} kind={kind} annotations={annotations} />
        ))}
      </div>
    </div>
  );
}

function TrendCard({ series, kind, annotations }: { series: TrendSeries; kind: "line" | "bar"; annotations: ChartAnnotation[] }) {
  const latest = [...series.points].reverse().find((p) => p.value !== null);
  const events = new Map<string, ChartAnnotation[]>();
  for (const a of annotations) {
    const point = series.points.find((p) => p.month === a.month);
    if (point) events.set(point.label, [...(events.get(point.label) ?? []), a]);
  }
  const data = series.points.map((p) => ({ ...p, events: events.get(p.label) ?? [] }));
  const Chart = kind === "line" ? LineChart : BarChart;

  return (
    <figure className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <figcaption className="flex items-start justify-between gap-3">
        <MetricLabel metricKey={series.key} label={series.label} className="text-xs font-medium uppercase tracking-wider text-fg-secondary" />
        {latest && (
          <span className="shrink-0 text-right">
            <span className="block text-lg font-semibold tabular-nums text-teal">{formatValue(latest.value, series.format)}</span>
            <span className="block text-[11px] text-fg-muted">
              {latest.fullLabel}
              {latest.partial ? " (so far)" : ""}
            </span>
          </span>
        )}
      </figcaption>
      <div className="mt-3 h-44" role="img" aria-label={describe(series)}>
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={data} margin={{ top: 12, right: 4, bottom: 0, left: 0 }} barGap={2}>
            <CartesianGrid stroke="var(--color-grid)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              width={44}
              tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => axisValue(v, series.format)}
            />
            <Tooltip
              content={({ active, payload }) => <ChartTooltip active={active} payload={payload} format={series.format} />}
              cursor={kind === "line" ? { stroke: "var(--color-line)" } : { fill: "var(--color-raised)" }}
            />
            {[...events.keys()].map((label) => (
              <ReferenceLine
                key={label}
                x={label}
                stroke="var(--color-teal)"
                strokeOpacity={0.6}
                strokeDasharray="2 3"
                label={{ value: "●", position: "top", fill: "var(--color-teal)", fontSize: 10 }}
              />
            ))}
            {kind === "line" ? (
              <>
                <Line
                  dataKey="previous"
                  name="Same month last year"
                  stroke="var(--color-teal-700)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
                <Line
                  dataKey="value"
                  name="This period"
                  stroke="var(--color-teal)"
                  strokeWidth={2.5}
                  dot={{ r: 2.5, fill: "var(--color-teal)", strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: "var(--color-teal)", stroke: "var(--color-page)", strokeWidth: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              </>
            ) : (
              <>
                <Bar dataKey="previous" name="Same month last year" fill="var(--color-teal-800)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="value" name="This period" fill="var(--color-teal)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </>
            )}
          </Chart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

type Row = TrendPoint & { events: ChartAnnotation[] };

function ChartTooltip({
  active,
  payload,
  format,
}: {
  active?: boolean;
  payload?: readonly { payload?: unknown }[];
  format: MetricFormat;
}) {
  const row = payload?.[0]?.payload as Row | undefined;
  if (!active || !row) return null;
  return (
    <div className="max-w-60 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-fg">
        {row.fullLabel}
        {row.partial ? " (so far)" : ""}
      </p>
      <p className="mt-1 flex justify-between gap-4 text-fg">
        <span className="text-fg-secondary">Value</span>
        <span className="font-semibold tabular-nums">
          {formatValue(row.value, format)}
          {row.estimated ? " est." : ""}
        </span>
      </p>
      {row.previous !== null && (
        <p className="flex justify-between gap-4">
          <span className="text-fg-secondary">A year earlier</span>
          <span className="tabular-nums text-fg">{formatValue(row.previous, format)}</span>
        </p>
      )}
      {row.events.map((e) => (
        <p key={e.date + e.label} className="mt-1.5 border-t border-line pt-1.5 text-teal-100">
          <span aria-hidden className="text-teal">● </span>
          {e.label}
        </p>
      ))}
    </div>
  );
}

function describe(s: TrendSeries): string {
  const pts = s.points.filter((p) => p.value !== null);
  return `${s.label} by month: ${pts.map((p) => `${p.fullLabel} ${formatValue(p.value, s.format)}`).join(", ")}`;
}
