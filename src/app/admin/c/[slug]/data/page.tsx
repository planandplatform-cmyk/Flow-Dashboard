import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { getClientBySlug, getViewer, isFfm } from "@/lib/data/portal";
import { listUploads } from "@/lib/data/uploads";
import { BREAKDOWNS } from "@/lib/ingest/manual";
import { screenshotReadingConfigured } from "@/lib/ingest/screenshot-reader";
import { METRICS } from "@/lib/metrics/config";
import { DATA_SOURCES, SOCIAL_SOURCES, SOURCE_LABELS } from "@/lib/metrics/types";
import { ManualEntry, type MetricOption } from "./manual-entry";
import { UploadHistory } from "./upload-history";
import { ScreenshotPanel } from "./screenshot-panel";
import { UploadPanel } from "./upload-panel";

export const metadata: Metadata = { title: "Manage data" };

const TABS = [
  { id: "upload", label: "Upload a file" },
  { id: "screenshots", label: "Screenshots & PDFs" },
  { id: "manual", label: "Enter manually" },
  { id: "history", label: "Upload history" },
] as const;

export default function DataPage(props: PageProps<"/admin/c/[slug]/data">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <DataPageContent {...props} />
    </Suspense>
  );
}

async function DataPageContent(props: PageProps<"/admin/c/[slug]/data">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isFfm(viewer.role)) notFound();
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const tab = TABS.find((t) => t.id === search.tab)?.id ?? "upload";
  const enabled = new Set(client.enabled_sources);
  const sourceOrder = [...DATA_SOURCES].sort((a, b) => Number(enabled.has(b)) - Number(enabled.has(a)));
  const sources = sourceOrder.map((s) => ({ value: s, label: SOURCE_LABELS[s], enabled: enabled.has(s) }));

  const metricOptions: MetricOption[] = Object.values(METRICS)
    .filter((m) => m.source !== "combined" && m.aggregation.type !== "ratio" && m.aggregation.type !== "derived_sum")
    .filter((m) => m.source !== "combined" && enabled.has(m.source))
    .map((m) => ({
      key: m.key,
      label: m.label,
      source: m.source as (typeof DATA_SOURCES)[number],
      sourceLabel: SOURCE_LABELS[m.source as (typeof DATA_SOURCES)[number]],
      format: m.format,
      aggregation: m.aggregation.type,
      dimensions: m.dimensions ?? [],
      definition: m.definition,
    }));

  const uploads = tab === "history" ? await listUploads(client.id) : [];

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">Manage data</p>
            <h1 className="mt-1 border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight sm:text-3xl">{client.name}</h1>
          </div>
          <Link
            href={`/c/${client.slug}`}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-secondary transition hover:border-line-focus hover:text-fg"
          >
            View report →
          </Link>
        </div>

        <nav aria-label="Data tabs" className="mt-8 flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
                tab === t.id ? "border-teal text-fg" : "border-transparent text-fg-secondary hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="mt-8">
          {tab === "upload" && <UploadPanel slug={client.slug} clientName={client.name} sources={sources} />}
          {tab === "screenshots" && <ScreenshotPanel slug={client.slug} clientName={client.name} configured={screenshotReadingConfigured()} enabled={client.enabled_sources} />}
          {tab === "manual" && (
            <ManualEntry
              slug={client.slug}
              metrics={metricOptions}
              platforms={sources.filter((s) => s.enabled && (SOCIAL_SOURCES as readonly string[]).includes(s.value))}
              breakdowns={BREAKDOWNS}
              demo={viewer.demo}
            />
          )}
          {tab === "history" && <UploadHistory slug={client.slug} uploads={uploads} demo={viewer.demo} />}
        </div>
      </main>
    </>
  );
}
