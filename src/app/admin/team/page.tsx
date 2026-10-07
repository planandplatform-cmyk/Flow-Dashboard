import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice } from "@/components/form";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { getAdminViewer, listTeam } from "@/lib/data/admin";
import { adminApiConfigured } from "@/lib/supabase/admin";
import { changeTeamRole, inviteTeamMember, sendSignInLink } from "../actions";
import { Members } from "../members";

export const metadata: Metadata = { title: "Team" };

export default function TeamPage() {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <Team />
    </Suspense>
  );
}

async function Team() {
  const viewer = await getAdminViewer();
  if (!viewer) notFound();
  const team = await listTeam();
  return (
    <>
      <PortalHeader viewer={viewer} />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <h1 className="border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight sm:text-3xl">Flow Forward Media team</h1>
        <p className="mt-3 text-fg-secondary">
          Team members see every client. <span className="text-fg">Admins</span> can also create clients, manage logins and change roles.{" "}
          <span className="text-fg">Staff</span> can upload data and write commentary.
        </p>
        {!adminApiConfigured() && !viewer.demo && (
          <div className="mt-6">
            <Notice tone="info">To send invites, add SUPABASE_SECRET_KEY to the environment variables.</Notice>
          </div>
        )}
        <div className="mt-8">
          <Members
            members={team}
            invite={inviteTeamMember}
            resend={sendSignInLink.bind(null, "/")}
            roles={[
              { value: "ffm_admin", label: "Admin" },
              { value: "ffm_staff", label: "Staff" },
            ]}
            changeRole={changeTeamRole}
            selfId={viewer.id}
            emptyText="No team members yet."
            inviteLabel="Invite a team member"
            demo={viewer.demo}
          />
        </div>
      </main>
    </>
  );
}
