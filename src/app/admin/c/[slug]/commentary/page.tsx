import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminClientTop } from "@/components/admin-client-top";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { draftingConfigured, NOTE_SECTIONS } from "@/lib/commentary/drafter";
import { getCommentaryForEdit, listCommentaryStatus, loadMonthFacts } from "@/lib/data/commentary";
import { getClientBySlug, getLatestDataDate, getViewer, isFfm } from "@/lib/data/portal";
import { addMonths, formatMonth, isValidMonthParam, monthOf, monthsBetween, todayIn } from "@/lib/dates";
import { SOURCE_LABELS, type DataSource } from "@/lib/metrics/types";
import { CommentaryEditor } from "./editor";

export const metadata: Metadata = { title: "Commentary" };

/** Channels the report writes a narrative for, in report order. */
const NARRATIVE_SOURCES: DataSource[] = ["meta_facebook", "meta_instagram", "tiktok", "linkedin", "ga4", "meta_ads", "google_ads"];
const NOTE_LABELS: Record<(typeof NOTE_SECTIONS)[number], string> = {
  content: "Content and engagement",
  demographics: "Audience and demographics",
  discovery: "Visibility and discovery",
  video: "Video and short-form",
};

export default function CommentaryPage(props: PageProps<"/admin/c/[slug]/commentary">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <Commentary {...props} />
    </Suspense>
  );
}

async function Commentary(props: PageProps<"/admin/c/[slug]/commentary">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isFfm(viewer.role)) notFound();
  const client = await getClientBySlug(slug);
  if (!client) notFound();
  await connection(); // uses today's date

  const thisMonth = monthOf(todayIn(client.timezone));
  let month: string;
  if (isValidMonthParam(search.month)) month = `${search.month}-01`;
  else {
    // Default: the latest month with data, which is usually the one to write up.
    const latest = await getLatestDataDate(client.id);
    month = latest ? monthOf(latest) : addMonths(thisMonth, -1);
  }

  const [commentary, statuses, facts] = await Promise.all([
    getCommentaryForEdit(client.id, month),
    listCommentaryStatus(client.id),
    loadMonthFacts(client, month),
  ]);
  const statusByMonth = new Map(statuses.map((s) => [s.month, s.status]));
  const months = monthsBetween(addMonths(thisMonth, -23), thisMonth)
    .reverse()
    .map((m) => ({ value: m.slice(0, 7), label: formatMonth(m), status: statusByMonth.get(m) ?? null }));

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        <AdminClientTop slug={client.slug} name={client.name} active="commentary" admin={viewer.role === "ffm_admin"} eyebrow="Monthly commentary" />
        <CommentaryEditor
          key={month + (commentary?.updated_at ?? "")}
          slug={client.slug}
          month={month}
          monthLabel={formatMonth(month)}
          months={months}
          initial={commentary}
          platforms={NARRATIVE_SOURCES.filter((s) => client.enabled_sources.includes(s)).map((s) => ({ id: s, label: SOURCE_LABELS[s] }))}
          notes={NOTE_SECTIONS.map((id) => ({ id, label: NOTE_LABELS[id] }))}
          facts={facts}
          aiConfigured={draftingConfigured()}
          demo={viewer.demo}
        />
      </main>
    </>
  );
}
