import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm text-center">
        <Image src="/brand/ffm-logo.png" alt="Flow Forward Media" width={2000} height={909} className="mx-auto h-10 w-auto" />
        <h1 className="mt-10 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-fg-secondary">This page does not exist, or your account does not have access to it.</p>
        <Link href="/" className="mt-8 inline-flex rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-page transition hover:bg-teal-200">
          Go to your reports
        </Link>
      </div>
    </main>
  );
}
