"use client";

import { useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "@/lib/metrics/format";
import type { MetricFormat } from "@/lib/metrics/types";
import type { GrowthMetric, TrendSeries } from "@/lib/report/trends";

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const axisValue = (v: number, format: MetricFormat) =>
  format === "percent" ? `${Math.round(v * 100)}%` : format === "currency" ? `$${compactNumber.format(v)}` : compactNumber.format(v);

function Chips<T extends string>({ items, value, onChange, label }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  if (items.length < 2) return null;
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          onClick={() => onChange(it.id)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
            value === it.id ? "border-teal bg-teal-950 text-teal" : "border-line bg-surface text-fg-secondary hover:border-line-focus hover:text-fg"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * One channel's measures over 12 months, against the same months a year
 * earlier. Buttons switch the measure; hover or tap for exact numbers.
 */
export function ChannelTrendChart({ series, color, channel }: { series: TrendSeries[]; color: string; channel: string }) {
  const [key, setKey] = useState(series[0]?.key ?? "");
  const s = series.find((x) => x.key === key) ?? series[0];
  if (!s) return null;
  const hasPrevious = s.points.some((p) => p.previous !== null);
  const latest = [...s.points].reverse().find((p) => p.value !== null);

  return (
    <figure className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <figcaption>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-secondary">{channel} month by month</p>
          {latest && (
            <p className="mt-1 text-lg font-semibold tabular-nums" style={{ color }}>
              {formatValue(latest.value, s.format)}{" "}
              <span className="text-xs font-normal text-fg-muted">
                {s.label}, {latest.fullLabel}
                {latest.partial ? " (so far)" : ""}
              </span>
            </p>
          )}
        </figcaption>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-5 rounded" style={{ background: color }} /> Last 12 months
          </span>
          {hasPrevious && (
            <span className="flex items-center gap-2">
              <span aria-hidden className="w-5 border-t-2 border-dashed border-fg-muted" /> Year before
            </span>
          )}
        </div>
      </div>
      <div className="mt-3">
        <Chips items={series.map((x) => ({ id: x.key, label: x.label }))} value={s.key} onChange={setKey} label={`${channel} measure`} />
      </div>
      <div className="mt-3 h-64" role="img" aria-label={`${channel} ${s.label} by month`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis width={48} tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => axisValue(v, s.format)} />
            <Tooltip
              cursor={{ stroke: "var(--color-line)" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as TrendSeries["points"][number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl">
                    <p className="font-semibold text-fg">
                      {row.fullLabel}
                      {row.partial ? " (so far)" : ""}
                    </p>
                    <p className="mt-1 flex justify-between gap-4">
                      <span className="text-fg-secondary">{s.label}</span>
                      <span className="font-semibold tabular-nums text-fg">{formatValue(row.value, s.format)}</span>
                    </p>
                    {row.previous !== null && (
                      <p className="flex justify-between gap-4">
                        <span className="text-fg-secondary">A year earlier</span>
                        <span className="tabular-nums text-fg">{formatValue(row.previous, s.format)}</span>
                      </p>
                    )}
                  </div>
                );
              }}
            />
            <Line dataKey="previous" stroke="var(--color-fg-muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} connectNulls isAnimationActive={false} />
            <Line
              dataKey="value"
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: color, stroke: "var(--color-page)", strokeWidth: 2 }}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/**
 * All social channels together: the combined total and each platform's line
 * for the chosen measure. Clicking a platform in the legend hides or shows it.
 */
export function SocialGrowthChart({ metrics, colors }: { metrics: GrowthMetric[]; colors: Record<string, string> }) {
  const [id, setId] = useState<GrowthMetric["id"]>(metrics[0]?.id ?? "followers");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const m = metrics.find((x) => x.id === id) ?? metrics[0];
  if (!m) return null;
  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <figure className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <figcaption className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Overall social growth, all channels</figcaption>
      <div className="mt-3">
        <Chips items={metrics.map((x) => ({ id: x.id, label: x.label }))} value={m.id} onChange={setId} label="Measure" />
      </div>
      <div className="mt-3 h-72" role="img" aria-label={`${m.label} by month, combined and by platform`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={m.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--color-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis width={48} tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => axisValue(v, m.format)} />
            <Tooltip
              cursor={{ stroke: "var(--color-line)" }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as GrowthMetric["points"][number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="min-w-44 rounded-lg border border-line bg-raised px-3 py-2 text-xs shadow-xl">
                    <p className="font-semibold text-fg">
                      {row.fullLabel}
                      {row.partial ? " (so far)" : ""}
                    </p>
                    <p className="mt-1 flex justify-between gap-4">
                      <span className="font-medium text-teal">Combined</span>
                      <span className="font-semibold tabular-nums text-fg">{formatValue(row.total, m.format)}</span>
                    </p>
                    {m.lines.map((l) => (
                      <p key={l.source} className="flex justify-between gap-4">
                        <span style={{ color: colors[l.source] }}>
                          {l.label}
                          {l.inTotal ? "" : "*"}
                        </span>
                        <span className="tabular-nums text-fg">{formatValue(row[l.source] as number | null, m.format)}</span>
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend
              onClick={(e) => typeof e.dataKey === "string" && toggle(e.dataKey)}
              wrapperStyle={{ fontSize: 12, cursor: "pointer", paddingTop: 8 }}
              formatter={(value: string, entry) => (
                <span style={{ color: hidden.has(String(entry.dataKey)) ? "var(--color-fg-muted)" : "var(--color-fg-secondary)" }}>{value}</span>
              )}
            />
            <Line
              dataKey="total"
              name="Combined"
              hide={hidden.has("total")}
              stroke="var(--color-teal)"
              strokeWidth={3}
              dot={{ r: 2.5, fill: "var(--color-teal)", strokeWidth: 0 }}
              connectNulls
              isAnimationActive={false}
            />
            {m.lines.map((l) => (
              <Line
                key={l.source}
                dataKey={l.source}
                name={l.inTotal ? l.label : `${l.label}*`}
                hide={hidden.has(l.source)}
                stroke={colors[l.source]}
                strokeWidth={1.75}
                strokeDasharray={l.inTotal ? undefined : "4 3"}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {m.note && <p className="mt-2 text-xs text-fg-muted">* {m.note}</p>}
      <p className="mt-1 text-xs text-fg-muted">Click a name under the chart to hide or show it.</p>
    </figure>
  );
}
