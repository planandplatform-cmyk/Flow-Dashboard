import Image from "next/image";
import Link from "next/link";
import { isFfm, type Client, type Viewer } from "@/lib/data/portal";

export function PortalHeader({ client, viewer }: { client?: Client; viewer: Viewer }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-shell/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center" aria-label="Flow Forward Media home">
          <Image src="/brand/ffm-logo.png" alt="Flow Forward Media" width={2000} height={909} className="hidden h-7 w-auto sm:block" priority />
          <Image src="/brand/ffm-mark.svg" alt="Flow Forward Media" width={580} height={908} className="h-7 w-auto sm:hidden" priority />
        </Link>

        {client && (
          <div className="ml-1 flex min-w-0 items-center gap-3 border-l border-line pl-4">
            {client.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={client.logo_url} alt="" className="h-8 w-8 rounded-md object-contain" />
            ) : (
              <span
                aria-hidden
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-raised text-sm font-semibold text-teal"
              >
                {client.name.charAt(0)}
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">{client.name}</p>
              <p className="truncate text-[11px] leading-tight text-fg-muted">Powered by Flow Forward Media</p>
            </div>
          </div>
        )}

        <nav className="ml-auto flex items-center gap-1 text-sm">
          {client && isFfm(viewer.role) && (
            <Link href={`/admin/c/${client.slug}/data`} className="hidden rounded-md px-3 py-2 text-fg-secondary transition hover:bg-raised hover:text-fg sm:block">
              Manage data
            </Link>
          )}
          <Link href="/glossary" className="rounded-md px-3 py-2 text-fg-secondary transition hover:bg-raised hover:text-fg">
            Glossary
          </Link>
          {viewer.demo ? (
            <span className="rounded-md border border-line-focus px-2 py-1 text-xs text-teal">Demo</span>
          ) : (
            <form action="/auth/signout" method="post">
              <button type="submit" className="rounded-md px-3 py-2 text-fg-secondary transition hover:bg-raised hover:text-fg">
                Sign out
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
