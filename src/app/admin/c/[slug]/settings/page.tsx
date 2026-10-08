import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/form";
import { AdminClientTop } from "@/components/admin-client-top";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { serviceAccountEmail } from "@/lib/connectors/google-auth";
import { getAdminViewer, getClientSettings, getConnectionStatus, listClientMembers } from "@/lib/data/admin";
import type { Client } from "@/lib/data/portal";
import { adminApiConfigured } from "@/lib/supabase/admin";
import { inviteClientUser, removeClientUser, sendSignInLink, setClientArchived, updateClientAccount } from "../../../actions";
import { ArchiveClient } from "../../../archive-client";
import { ClientForm } from "../../../client-form";
import { Members } from "../../../members";
import { ConnectionCard, type ChannelCopy } from "./connection-card";
import { connectSource, disconnectSource, pullHistory, syncNow } from "./sync-actions";

const CHANNELS: { source: "ga4" | "search_console"; copy: ChannelCopy }[] = [
  {
    source: "ga4",
    copy: {
      title: "Google Analytics (GA4)",
      blurb: "Pulls website numbers every night, read-only.",
      idLabel: "GA4 Property ID",
      placeholder: "412345678",
      hint: "GA4 Admin, Property details. Numbers only, not the G- ID. Connecting pulls the last 13 months.",
      accessHelp: "In the client's GA4: Admin, Property access management, add this email as a Viewer.",
      inputMode: "numeric",
    },
  },
  {
    source: "search_console",
    copy: {
      title: "Google Search Console",
      blurb: "Pulls Google search rankings every night, read-only.",
      idLabel: "Search Console site",
      placeholder: "example.com",
      hint: "As shown in Search Console's property list: example.com for a domain property, or https://www.example.com/. Connecting pulls the last 13 months.",
      accessHelp: "In the client's Search Console: Settings, Users and permissions, Add user, this email, Restricted.",
      inputMode: "url",
    },
  },
];

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
  const [members, statuses] = await Promise.all([
    listClientMembers(client.id),
    Promise.all(CHANNELS.map((c) => getConnectionStatus(client.id, c.source))),
  ]);
  const serviceEmail = serviceAccountEmail();
  const synced = CHANNELS.map((c, i) => ({ ...c, status: statuses[i] })).filter((c) => client.enabled_sources.includes(c.source));

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

        {synced.length > 0 && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">Automatic data</h2>
            <p className="mb-4 text-sm text-fg-secondary">
              Connected channels update every night on their own. Uploads still work for everything else.
            </p>
            <div className="space-y-4">
              {synced.map(({ source, copy, status }) => (
                <ConnectionCard
                  key={source}
                  copy={copy}
                  status={status}
                  serviceEmail={serviceEmail}
                  ready={Boolean(serviceEmail) && adminApiConfigured()}
                  demo={viewer.demo}
                  connect={connectSource.bind(null, client.slug, source)}
                  syncNow={syncNow.bind(null, client.slug, source)}
                  pullHistory={pullHistory.bind(null, client.slug, source)}
                  disconnect={disconnectSource.bind(null, client.slug, source)}
                />
              ))}
            </div>
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
