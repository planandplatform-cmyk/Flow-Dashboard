import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PortalHeader } from "@/components/portal-header";
import { ReportSkeleton } from "@/components/skeleton";
import { getAdminViewer } from "@/lib/data/admin";
import { createClientAccount } from "../../actions";
import { ClientForm } from "../../client-form";

export const metadata: Metadata = { title: "New client" };

export default function NewClientPage() {
  return (
    <Suspense fallback={<ReportSkeleton />}>
      <NewClient />
    </Suspense>
  );
}

async function NewClient() {
  const viewer = await getAdminViewer();
  if (!viewer) notFound();
  return (
    <>
      <PortalHeader viewer={viewer} />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
        <h1 className="border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight sm:text-3xl">New client</h1>
        <p className="mt-3 text-fg-secondary">Create the client and pick their channels. You can invite their logins on the next screen.</p>
        <div className="mt-8">
          <ClientForm action={createClientAccount} mode="create" demo={viewer.demo} />
        </div>
      </main>
    </>
  );
}
