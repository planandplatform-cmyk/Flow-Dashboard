import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminClientTop } from "@/components/admin-client-top";
import { Notice } from "@/components/form";
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
import { ReportImport } from "./report-import";
import { ScreenshotPanel } from "./screenshot-panel";
import { UploadPanel } from "./upload-panel";

export const metadata: Metadata = { title: "Manage data" };

// Reading a long report with AI can take a few minutes.
export const maxDuration = 300;

const TABS = [
  { id: "upload", label: "Upload a file" },
  { id: "screenshots", label: "Screenshots & PDFs" },
  { id: "report", label: "Import a full report" },
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
        <AdminClientTop slug={client.slug} name={client.name} active="data" admin={viewer.role === "ffm_admin"} eyebrow="Manage data" />

        <nav aria-label="Data tabs" className="mt-6 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`?tab=${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
                tab === t.id ? "border-teal bg-teal-950 text-teal" : "border-line bg-surface text-fg-secondary hover:border-line-focus hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="mt-8">
          {tab === "upload" && <UploadPanel slug={client.slug} clientName={client.name} sources={sources} />}
          {tab === "screenshots" && <ScreenshotPanel slug={client.slug} clientName={client.name} configured={screenshotReadingConfigured()} enabled={client.enabled_sources} />}
          {tab === "report" &&
            (screenshotReadingConfigured() ? (
              <ReportImport slug={client.slug} clientName={client.name} />
            ) : (
              <Notice tone="info" title="Report reading is not set up yet">
                Add an Anthropic API key as ANTHROPIC_API_KEY in the Vercel environment variables, then redeploy.
              </Notice>
            ))}
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
