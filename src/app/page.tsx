import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReportSkeleton } from "@/components/skeleton";
import { PortalHeader } from "@/components/portal-header";
import { listArchivedClients } from "@/lib/data/admin";
import { getClientHealth, type ClientHealth } from "@/lib/data/commentary";
import { addMonths, daysBetween, formatDay, formatMonth, monthOf } from "@/lib/dates";
import { getViewer, isFfm, listClients } from "@/lib/data/portal";
import { SOURCE_LABELS } from "@/lib/metrics/types";

export default function Home() {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <ClientList />
    </Suspense>
  );
}

async function ClientList() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const clients = await listClients();
  const admin = viewer.role === "ffm_admin";
  const archived = admin ? await listArchivedClients() : [];
  await connection(); // health compares against today's date
  const health = isFfm(viewer.role) ? await getClientHealth(clients.map((c) => c.id)) : {};
  // Client users with a single business go straight to their report.
  if (!isFfm(viewer.role) && clients.length === 1) redirect(`/c/${clients[0].slug}`);

  return (
    <>
      <PortalHeader viewer={viewer} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight">
            {isFfm(viewer.role) ? "Clients" : "Your businesses"}
          </h1>
          {admin && (
            <div className="flex gap-2 text-sm">
              <Link href="/admin/team" className="rounded-lg border border-line bg-surface px-3 py-2 text-fg-secondary hover:border-line-focus hover:text-fg">
                Team
              </Link>
              <Link href="/admin/clients/new" className="rounded-lg bg-teal px-3 py-2 font-semibold text-page hover:bg-teal-200">
                + New client
              </Link>
            </div>
          )}
        </div>
        {clients.length === 0 ? (
          <p className="mt-6 text-fg-secondary">
            {isFfm(viewer.role)
              ? "No clients yet."
              : "Your account is not linked to a business yet. Please contact Flow Forward Media."}
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface transition hover:border-line-focus">
                <Link href={`/c/${c.slug}`} className="block p-5 pb-3">
                  <p className="font-semibold">{c.name}</p>
                  <p className="mt-2 text-xs text-fg-muted">{c.enabled_sources.map((s) => SOURCE_LABELS[s]).join(" · ")}</p>
                  {health[c.id] && <HealthLines health={health[c.id]} />}
                </Link>
                {isFfm(viewer.role) && (
                  <div className="flex gap-4 border-t border-line px-5 py-3 text-sm">
                    <Link href={`/c/${c.slug}`} className="text-teal hover:text-teal-200">Report</Link>
                    <Link href={`/admin/c/${c.slug}/data`} className="text-fg-secondary hover:text-fg">Data</Link>
                    <Link href={`/admin/c/${c.slug}/commentary`} className="text-fg-secondary hover:text-fg">Commentary</Link>
                    {admin && (
                      <Link href={`/admin/c/${c.slug}/settings`} className="text-fg-secondary hover:text-fg">Settings</Link>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {admin && archived.length > 0 && (
          <details className="mt-10 text-sm">
            <summary className="cursor-pointer text-fg-secondary">Archived clients ({archived.length})</summary>
            <ul className="mt-3 space-y-2">
              {archived.map((c) => (
                <li key={c.slug}>
                  <Link href={`/admin/c/${c.slug}/settings`} className="text-fg-secondary hover:text-fg">{c.name}</Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </main>
    </>
  );
}

/** At-a-glance health for FFM: data freshness, commentary, and sync problems. */
function HealthLines({ health }: { health: ClientHealth }) {
  const today = new Date().toISOString().slice(0, 10);
  const lastMonth = addMonths(monthOf(today), -1);
  const age = health.lastDataDate ? daysBetween({ start: health.lastDataDate, end: today }) - 1 : null;
  const stale = age === null || age > 35;
  const commentaryDue = !health.lastPublishedMonth || health.lastPublishedMonth < lastMonth;
  const ok = "text-fg-secondary";
  const warn = "text-negative";
  return (
    <ul className="mt-4 space-y-1.5 text-xs">
      <li className={stale ? warn : ok}>
        <span aria-hidden>{stale ? "⚠ " : "● "}</span>
        {health.lastDataDate ? `Data through ${formatDay(health.lastDataDate)}${stale ? ` (${age} days old)` : ""}` : "No data yet"}
      </li>
      <li className={commentaryDue ? warn : ok}>
        <span aria-hidden>{commentaryDue ? "⚠ " : "● "}</span>
        {commentaryDue
          ? `${formatMonth(lastMonth)} commentary not published${health.lastPublishedMonth ? ` (latest: ${formatMonth(health.lastPublishedMonth)})` : ""}`
          : `Commentary published for ${formatMonth(health.lastPublishedMonth!)}`}
        {health.draftMonth && health.draftMonth > (health.lastPublishedMonth ?? "") ? ` · ${formatMonth(health.draftMonth)} draft in progress` : ""}
      </li>
      {health.failedSync && (
        <li className={warn}>
          <span aria-hidden>⚠ </span>
          {SOURCE_LABELS[health.failedSync.source as keyof typeof SOURCE_LABELS] ?? health.failedSync.source} sync failed {formatDay(health.failedSync.at.slice(0, 10))}
        </li>
      )}
      {health.lastActivityAt && <li className="text-fg-muted">Last upload or sync {formatDay(health.lastActivityAt.slice(0, 10))}</li>}
    </ul>
  );
}
