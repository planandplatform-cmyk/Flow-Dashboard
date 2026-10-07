"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type State = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "error"; message: string };

export function LoginForm({ next, demo }: { next?: string; demo: boolean }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    if (demo) {
      window.location.href = next ?? "/";
      return;
    }

    setState({ kind: "sending" });
    const redirect = new URL("/auth/confirm", window.location.origin);
    if (next) redirect.searchParams.set("next", next);

    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: {
        // Only people FFM has invited can sign in.
        shouldCreateUser: false,
        emailRedirectTo: redirect.toString(),
      },
    });

    // Same message whether or not the address has an account, so the form
    // cannot be used to discover who is a client.
    if (error && error.status !== 422 && error.status !== 400) {
      const message =
        error.status === 429
          ? "Too many sign-in emails were requested. Wait a few minutes, then try again."
          : `We could not send your link. Please try again in a minute. (${error.message})`;
      setState({ kind: "error", message });
      return;
    }
    setState({ kind: "sent", email });
  }

  if (state.kind === "sent") {
    return (
      <div className="rounded-xl border border-line bg-surface p-6 text-center" role="status">
        <p className="text-lg font-medium text-fg">Check your email</p>
        <p className="mt-2 text-sm text-fg-secondary">
          If <span className="text-fg">{state.email}</span> has access, a sign-in link is on its way. The link works once
          and expires in one hour.
        </p>
        <button
          type="button"
          onClick={() => setState({ kind: "idle" })}
          className="mt-4 text-sm text-teal hover:text-teal-200"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-xs font-medium uppercase tracking-wider text-fg-secondary">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
          className="mt-2 block w-full rounded-lg border border-line bg-raised px-4 py-3 text-fg placeholder:text-fg-muted focus:border-teal focus:outline-none focus:ring-2 focus:ring-line-focus"
        />
      </div>
      <button
        type="submit"
        disabled={state.kind === "sending"}
        className="w-full rounded-lg bg-teal px-4 py-3 font-semibold text-page transition hover:bg-teal-200 disabled:opacity-60"
      >
        {state.kind === "sending" ? "Sending link..." : demo ? "Enter demo" : "Email me a sign-in link"}
      </button>
      {state.kind === "error" && (
        <p className="text-sm text-negative" role="alert">
          {state.message}
        </p>
      )}
    </form>
  );
}
