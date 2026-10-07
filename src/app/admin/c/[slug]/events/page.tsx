import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AdminClientTop } from "@/components/admin-client-top";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { listEvents } from "@/lib/data/commentary";
import { getClientBySlug, getViewer, isFfm } from "@/lib/data/portal";
import { todayIn } from "@/lib/dates";
import { deleteEvent, saveEvent } from "./actions";
import { Events } from "./events";

export const metadata: Metadata = { title: "Events" };

export default function EventsPage(props: PageProps<"/admin/c/[slug]/events">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <EventsContent {...props} />
    </Suspense>
  );
}

async function EventsContent(props: PageProps<"/admin/c/[slug]/events">) {
  const { slug } = await props.params;
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!isFfm(viewer.role)) notFound();
  const client = await getClientBySlug(slug);
  if (!client) notFound();
  await connection(); // uses today's date
  const events = await listEvents(client.id);

  return (
    <>
      <PortalHeader client={client} viewer={viewer} />
      <main className="mx-auto max-w-4xl px-4 pb-24 pt-8 sm:px-6">
        <AdminClientTop slug={client.slug} name={client.name} active="events" admin={viewer.role === "ffm_admin"} eyebrow="Timeline events" />
        <p className="mt-6 max-w-2xl text-sm leading-relaxed text-fg-secondary">
          Mark anything that explains a change in the numbers: a budget move, a new website, a promotion, a storm. Each event shows as a teal marker on
          every trend chart in {client.name}&apos;s report, and is listed under the summary for the period it falls in. Clients can see events.
        </p>
        <Events
          events={events}
          today={todayIn(client.timezone)}
          save={saveEvent.bind(null, client.slug)}
          remove={deleteEvent.bind(null, client.slug)}
          demo={viewer.demo}
        />
      </main>
    </>
  );
}
