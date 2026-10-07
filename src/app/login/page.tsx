import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";
import { isDemoMode } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-teal-800/30 blur-3xl"
      />
      <div className="relative w-full max-w-sm">
        <Image
          src="/brand/ffm-logo.png"
          alt="Flow Forward Media"
          width={2000}
          height={909}
          priority
          className="mx-auto h-12 w-auto"
        />
        <h1 className="mt-10 text-center text-2xl font-semibold tracking-tight">Client Performance Portal</h1>
        <p className="mt-2 text-center text-sm text-fg-secondary">
          Sign in with your email. We will send you a secure link, no password needed.
        </p>
        <Suspense fallback={<div className="mt-8 h-32" />}>
          <LoginBody searchParams={props.searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function LoginBody({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : undefined;
  const linkError = params.error === "link";
  const reason = typeof params.reason === "string" ? params.reason : "";
  const demo = isDemoMode();

  return (
    <>
      {linkError && (
        <p className="mt-6 rounded-lg border border-negative/40 bg-negative/10 p-3 text-sm text-negative" role="alert">
          {reason === "cross_site"
            ? "Open the link directly from the email, then press the button on the page that opens."
            : "That sign-in link has expired or was already used. Request a new one below, and use only the newest email."}
          {reason && reason !== "cross_site" && <span className="mt-1 block text-xs opacity-70">Reason: {reason}</span>}
        </p>
      )}
      {demo && (
        <p className="mt-6 rounded-lg border border-line-focus bg-teal-950 p-3 text-sm text-teal-100">
          Demo mode: Supabase is not connected yet, so this opens the sample Wieler Roofing report.
        </p>
      )}
      <div className="mt-8">
        <LoginForm next={next} demo={demo} />
      </div>
    </>
  );
}
