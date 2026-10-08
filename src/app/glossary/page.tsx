import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ReportSkeleton } from "@/components/skeleton";
import { PortalHeader } from "@/components/portal-header";
import { getViewer } from "@/lib/data/portal";
import { METRICS } from "@/lib/metrics/config";
import { GLOSSARY } from "@/lib/metrics/glossary";
import { SOURCE_LABELS } from "@/lib/metrics/types";

export const metadata: Metadata = { title: "Glossary" };

export default function GlossaryPage() {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <Glossary />
    </Suspense>
  );
}

async function Glossary() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const bySource = new Map<string, typeof METRICS[string][]>();
  for (const def of Object.values(METRICS).filter((m) => !m.internal)) {
    const label = def.source === "combined" ? "All Social Platforms" : SOURCE_LABELS[def.source];
    bySource.set(label, [...(bySource.get(label) ?? []), def]);
  }

  return (
    <>
      <PortalHeader viewer={viewer} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight sm:text-3xl">Key Terms</h1>
        <p className="mt-3 max-w-2xl text-fg-secondary">
          Plain-language definitions for every number in your report. You can also hover or tap the ? next to any metric.
        </p>

        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {GLOSSARY.map((g) => (
            <div key={g.id} id={g.id} className="rounded-xl border border-line bg-surface p-5">
              <h2 className="font-semibold text-teal">{g.term}</h2>
              <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{g.definition}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-14 border-l-4 border-teal pl-4 text-xl font-semibold tracking-tight">Every metric</h2>
        <div className="mt-6 space-y-10">
          {[...bySource.entries()].map(([source, defs]) => (
            <div key={source}>
              <h3 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">{source}</h3>
              <dl className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {defs.map((d) => (
                  <div key={d.key} className="grid grid-cols-1 gap-1 px-5 py-4 sm:grid-cols-[220px_1fr] sm:gap-6">
                    <dt className="font-medium">{d.label}</dt>
                    <dd className="text-sm leading-relaxed text-fg-secondary">{d.definition}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
