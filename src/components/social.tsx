import { PLATFORM_COLORS, type Bar } from "@/lib/report/social";
import type { SocialSource } from "@/lib/metrics/types";

/** Platform label in the platform's brand color. Brand colors are used only here and in bars. */
export function PlatformChip({ source, label }: { source: SocialSource; label: string }) {
  return (
    <span className="inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-widest text-white" style={{ backgroundColor: PLATFORM_COLORS[source] }}>
      {label}
    </span>
  );
}

/** Horizontal bars for absolute values or shares, scaled to the largest. */
export function BarList({ bars }: { bars: Bar[] }) {
  const max = Math.max(...bars.map((b) => b.value), 0) || 1;
  return (
    <ul className="space-y-3">
      {bars.map((b) => (
        <li key={b.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-fg-secondary">{b.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-raised">
            <span className="block h-full rounded-full" style={{ width: `${Math.max(1, (b.value / max) * 100)}%`, backgroundColor: b.color }} />
          </span>
          <span className="text-right font-semibold tabular-nums text-fg">{b.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** LinkedIn competitor comparison: rank, company, values with the change LinkedIn shows. */
export function CompetitorTable({ table }: { table: import("@/lib/report/social").CompetitorTable }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">LinkedIn competitor comparison</caption>
        <thead className="bg-raised">
          <tr>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">Rank</th>
            <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-fg-secondary">Company</th>
            {table.columns.map((c) => (
              <th key={c.metric} scope="col" className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-fg-secondary">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface">
          {table.rows.map((r) => (
            <tr key={r.company} className={`border-t border-line ${r.own ? "bg-teal-950/50" : ""}`}>
              <td className="px-4 py-3 tabular-nums text-fg-secondary">{r.rank}</td>
              <td className="px-4 py-3">
                <span className="font-medium text-fg">{r.company}</span>
                {r.own && <span className="ml-2 rounded-md border border-teal-800 bg-teal-950 px-1.5 py-0.5 text-[11px] font-medium text-teal">Your Page</span>}
              </td>
              {table.columns.map((c) => {
                const cell = r.cells[c.metric];
                return (
                  <td key={c.metric} className="px-4 py-3 text-right tabular-nums">
                    {cell ? (
                      <>
                        <span className="block font-semibold text-fg">{cell.value}</span>
                        {cell.change !== null && (
                          <span className={`block text-xs ${cell.change > 0 ? "text-positive" : cell.change < 0 ? "text-negative" : "text-fg-muted"}`}>
                            {cell.change > 0 ? "▲ " : cell.change < 0 ? "▼ " : ""}
                            {Math.abs(cell.change * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-fg-muted">Not available</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
