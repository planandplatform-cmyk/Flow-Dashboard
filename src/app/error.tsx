"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <Image src="/brand/ffm-logo.png" alt="Flow Forward Media" width={2000} height={909} className="mx-auto h-10 w-auto" />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          The page could not load. Try again, and if it keeps happening, let Flow Forward Media know
          {error.digest ? ` (reference ${error.digest})` : ""}.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <button type="button" onClick={() => retry()} className="rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-page transition hover:bg-teal-200">
            Try again
          </button>
          <Link href="/" className="rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg-secondary transition hover:border-line-focus hover:text-fg">
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
