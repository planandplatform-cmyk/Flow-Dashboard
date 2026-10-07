import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { AdminClientTop } from "@/components/admin-client-top";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { ACTIVITY_GROUPS, activityGroup, describeActivity } from "@/lib/activity";
import { listActivity } from "@/lib/data/commentary";
import { getClientBySlug, getViewer, isFfm } from "@/lib/data/portal";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage(props: PageProps<"/admin/c/[slug]/activity">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <Activity {...props} />
    </Suspense>
  );
}

const STATUS: Record<string, { label: string; tone: string }> = {
  succeeded: { label: "Done", tone: "border-teal-800 bg-teal-950 text-teal" },
  failed: { label: "Failed", tone: "border-negative/40 bg-negative/10 text-negative" },
  running: { label: "Running", tone: "border-line bg-raised text-fg-secondary" },
  pending: { label: "Waiting", tone: "border-line bg-raised text-fg-secondary" },
  rolled_back: { label: "Rolled back", tone: "border-line bg-raised text-fg-secondary" },
};

async function Activity(props: PageProps<"/admin/c/[slug]/activity">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isFfm(viewer.role)) notFound();
  const client = await getClientBySlug(slug);
  if (!client) notFound();

  const group = ACTIVITY_GROUPS.find((g) => g.id === search.type)?.id ?? null;
  const all = await listActivity(client.id, 200);
  const entries = group ? all.filter((e) => activityGroup(e.action) === group) : all;
  const when = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: client.timezone });
  const chip = (on: boolean) =>
    `shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
      on ? "border-teal bg-teal-950 text-teal" : "border-line bg-surface text-fg-secondary hover:border-line-focus hover:text-fg"
    }`;

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />
      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        <AdminClientTop slug={client.slug} name={client.name} active="activity" admin={viewer.role === "ffm_admin"} eyebrow="Activity log" />
        <p className="mt-6 max-w-2xl text-sm text-fg-secondary">
          Every upload, sync, publish and settings change for {client.name}, newest first. Entries cannot be edited or deleted. Times are{" "}
          {client.timezone.replace(/_/g, " ")}.
        </p>

        <nav aria-label="Filter activity" className="mt-6 flex gap-2 overflow-x-auto [scrollbar-width:none]">
          <Link href="?" className={chip(group === null)} aria-current={group === null ? "page" : undefined}>
            All
          </Link>
          {ACTIVITY_GROUPS.map((g) => (
            <Link key={g.id} href={`?type=${g.id}`} className={chip(group === g.id)} aria-current={group === g.id ? "page" : undefined}>
              {g.label}
            </Link>
          ))}
        </nav>

        {viewer.demo ? (
          <p className="mt-6 rounded-xl border border-dashed border-line p-8 text-sm text-fg-secondary">Demo mode: the log fills in once Supabase is connected.</p>
        ) : entries.length === 0 ? (
          <p className="mt-6 rounded-xl border border-dashed border-line p-8 text-sm text-fg-secondary">Nothing here yet.</p>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {entries.map((e) => {
              const status = e.status ? STATUS[e.status] : e.action === "upload.rollback" ? STATUS.rolled_back : null;
              return (
                <li key={e.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <time dateTime={e.at} className="shrink-0 text-xs tabular-nums text-fg-muted sm:w-40">
                    {when.format(new Date(e.at))}
                  </time>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg">{describeActivity(e.action, e.details)}</p>
                    {typeof e.details.error === "string" && e.details.error && <p className="mt-0.5 text-xs text-negative">{e.details.error}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-fg-secondary sm:w-48 sm:truncate sm:text-right">{e.actor ?? (e.kind === "sync" ? "Automatic" : "")}</span>
                  {status && <span className={`w-fit shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${status.tone}`}>{status.label}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
