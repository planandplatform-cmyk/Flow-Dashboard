import Link from "next/link";

export type AdminTab = "data" | "commentary" | "events" | "activity" | "settings";

/** Title and section tabs shared by every FFM page for one client. */
export function AdminClientTop({
  slug,
  name,
  active,
  admin,
  eyebrow,
}: {
  slug: string;
  name: string;
  active: AdminTab;
  admin: boolean;
  eyebrow: string;
}) {
  const tabs: { id: AdminTab | "report"; label: string; href: string }[] = [
    { id: "report", label: "Report", href: `/c/${slug}` },
    { id: "data", label: "Data", href: `/admin/c/${slug}/data` },
    { id: "commentary", label: "Commentary", href: `/admin/c/${slug}/commentary` },
    { id: "events", label: "Events", href: `/admin/c/${slug}/events` },
    { id: "activity", label: "Activity", href: `/admin/c/${slug}/activity` },
    ...(admin ? [{ id: "settings" as const, label: "Settings", href: `/admin/c/${slug}/settings` }] : []),
  ];
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">{eyebrow}</p>
      <h1 className="mt-1 border-l-4 border-teal pl-4 text-2xl font-semibold tracking-tight sm:text-3xl">{name}</h1>
      <nav aria-label="Client admin" className="mt-6 flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            aria-current={active === t.id ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
              active === t.id ? "border-teal text-fg" : "border-transparent text-fg-secondary hover:text-fg"
            }`}
          >
            {t.label}
            {t.id === "report" && <span aria-hidden> ↗</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
