import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ReportSkeleton } from "@/components/skeleton";
import { PortalHeader } from "@/components/portal-header";
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
  // Client users with a single business go straight to their report.
  if (!isFfm(viewer.role) && clients.length === 1) redirect(`/c/${clients[0].slug}`);

  return (
    <>
      <PortalHeader viewer={viewer} />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <h1 className="border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight">
          {isFfm(viewer.role) ? "Clients" : "Your businesses"}
        </h1>
        {clients.length === 0 ? (
          <p className="mt-6 text-fg-secondary">
            Your account is not linked to a business yet. Please contact Flow Forward Media.
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((c) => (
              <li key={c.id} className="rounded-xl border border-line bg-surface transition hover:border-line-focus">
                <Link href={`/c/${c.slug}`} className="block p-5 pb-3">
                  <p className="font-semibold">{c.name}</p>
                  <p className="mt-2 text-xs text-fg-muted">{c.enabled_sources.map((s) => SOURCE_LABELS[s]).join(" · ")}</p>
                </Link>
                {isFfm(viewer.role) && (
                  <div className="flex gap-4 border-t border-line px-5 py-3 text-sm">
                    <Link href={`/c/${c.slug}`} className="text-teal hover:text-teal-200">Report</Link>
                    <Link href={`/admin/c/${c.slug}/data`} className="text-fg-secondary hover:text-fg">Manage data</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
