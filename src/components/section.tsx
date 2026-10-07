export function Section({
  id,
  number,
  title,
  intro,
  children,
}: {
  id: string;
  number?: number;
  title: string;
  intro?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="border-l-4 border-teal pl-4 text-xl font-semibold tracking-tight sm:text-2xl">
        {number !== undefined && <span className="mr-2 text-teal">{number}.</span>}
        {title}
      </h2>
      {intro && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fg-secondary sm:text-base">{intro}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-line bg-surface ${className}`}>{children}</div>;
}

/** Dark table: #1A1A1A header with uppercase gray labels, teal row hover. */
export function DataTable({
  columns,
  rows,
  footer,
  caption,
}: {
  columns: { label: React.ReactNode; align?: "left" | "right" }[];
  rows: React.ReactNode[][];
  footer?: React.ReactNode[];
  caption?: string;
}) {
  const align = (a?: "left" | "right") => (a === "right" ? "text-right" : "text-left");
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-raised">
          <tr>
            {columns.map((c, i) => (
              <th
                key={i}
                scope="col"
                className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-fg-secondary ${align(c.align)}`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface">
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-line transition-colors hover:bg-teal-950">
              {row.map((cell, i) => (
                <td key={i} className={`px-4 py-3 tabular-nums ${align(columns[i]?.align)} ${i === 0 ? "text-fg" : "text-fg-secondary"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot className="bg-raised">
            <tr className="border-t border-line">
              {footer.map((cell, i) => (
                <td key={i} className={`px-4 py-3 font-semibold tabular-nums text-teal ${align(columns[i]?.align)}`}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Horizontal share bar list (demographics, discovery, format mix). */
export function ShareBars({ items }: { items: { bucket: string; share: number }[] }) {
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.bucket}>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-fg">{it.bucket}</span>
            <span className="tabular-nums text-teal">{(it.share * 100).toFixed(1)}%</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-800 via-teal-600 to-teal"
              style={{ width: `${Math.min(100, it.share * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Prose({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="space-y-4">
      {text.split(/\n{2,}/).map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
