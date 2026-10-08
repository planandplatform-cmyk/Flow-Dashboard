import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/form";
import { AdminClientTop } from "@/components/admin-client-top";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { serviceAccountEmail } from "@/lib/connectors/google-auth";
import { getAdminViewer, getClientSettings, getGa4Status, listClientMembers } from "@/lib/data/admin";
import type { Client } from "@/lib/data/portal";
import { adminApiConfigured } from "@/lib/supabase/admin";
import { inviteClientUser, removeClientUser, sendSignInLink, setClientArchived, updateClientAccount } from "../../../actions";
import { ArchiveClient } from "../../../archive-client";
import { ClientForm } from "../../../client-form";
import { Members } from "../../../members";
import { Ga4Connection } from "./ga4-connection";
import { connectGa4, disconnectGa4, pullGa4History, syncGa4Now } from "./sync-actions";

export const metadata: Metadata = { title: "Client settings" };

// Connecting GA4 pulls 13 months of history in the same request.
export const maxDuration = 300;

export default function SettingsPage(props: PageProps<"/admin/c/[slug]/settings">) {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <Settings {...props} />
    </Suspense>
  );
}

async function Settings(props: PageProps<"/admin/c/[slug]/settings">) {
  const [{ slug }, search] = await Promise.all([props.params, props.searchParams]);
  const viewer = await getAdminViewer();
  if (!viewer) notFound();
  const client = await getClientSettings(slug);
  if (!client) notFound();
  const [members, ga4] = await Promise.all([listClientMembers(client.id), getGa4Status(client.id)]);
  const serviceEmail = serviceAccountEmail();

  return (
    <>
      <PortalHeader client={client as unknown as Client} viewer={viewer} />
      <main className="mx-auto max-w-3xl space-y-12 px-4 pb-24 pt-8 sm:px-6">
        <AdminClientTop slug={client.slug} name={client.name} active="settings" admin eyebrow="Client settings" />

        {search.created === "1" && <Notice tone="success">Client created. Next, invite the people who should see this report.</Notice>}
        {client.archived_at && <Notice tone="warning">This client is archived. Its logins see nothing until it is restored.</Notice>}

        <section>
          <h2 className="mb-4 text-lg font-semibold">Logins</h2>
          <p className="mb-4 text-sm text-fg-secondary">
            Each person signs in with their own email and only ever sees this client. One person can be given access to several clients.
          </p>
          {!adminApiConfigured() && !viewer.demo && (
            <div className="mb-4">
              <Notice tone="info">
                To send invites, add SUPABASE_SECRET_KEY to the environment variables. People who already have a login can still be added.
              </Notice>
            </div>
          )}
          <Members
            members={members}
            invite={inviteClientUser.bind(null, client.slug)}
            remove={removeClientUser.bind(null, client.slug)}
            resend={sendSignInLink.bind(null, `/c/${client.slug}`)}
            emptyText="Nobody can log in to this client yet."
            inviteLabel="Invite someone from this business"
            demo={viewer.demo}
          />
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold">Details and channels</h2>
          <ClientForm action={updateClientAccount.bind(null, client.slug)} initial={client} mode="edit" demo={viewer.demo} />
        </section>

        {client.enabled_sources.includes("ga4") && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">Automatic data</h2>
            <p className="mb-4 text-sm text-fg-secondary">
              Connected channels update every night on their own. Uploads still work for everything else.
            </p>
            <Ga4Connection
              status={ga4}
              serviceEmail={serviceEmail}
              ready={Boolean(serviceEmail) && adminApiConfigured()}
              demo={viewer.demo}
              connect={connectGa4.bind(null, client.slug)}
              syncNow={syncGa4Now.bind(null, client.slug)}
              pullHistory={pullGa4History.bind(null, client.slug)}
              disconnect={disconnectGa4.bind(null, client.slug)}
            />
          </section>
        )}

        <section>
          <h2 className="mb-4 text-lg font-semibold">Archive</h2>
          <ArchiveClient archived={Boolean(client.archived_at)} action={setClientArchived.bind(null, client.slug)} demo={viewer.demo} />
        </section>
      </main>
    </>
  );
}
