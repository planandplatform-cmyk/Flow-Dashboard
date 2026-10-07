"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Download the current report view as a PDF, dark (as on screen) or a white
 * print-friendly version. The PDF follows the same dates and comparison.
 */
export function PdfMenu({ href, note }: { href: string; note?: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  const join = href.includes("?") ? "&" : "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-full min-h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg-secondary transition hover:border-line-focus hover:text-fg"
      >
        <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M8 2v8m0 0L5 7m3 3 3-3M3 12.5h10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        PDF
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl border border-line bg-shell p-2 shadow-2xl">
          <a href={href} download onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-raised">
            <span className="block text-sm font-medium text-fg">Download PDF</span>
            <span className="block text-xs text-fg-muted">Dark, as it looks on screen</span>
          </a>
          <a href={`${href}${join}theme=print`} download onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-raised">
            <span className="block text-sm font-medium text-fg">Print-friendly PDF</span>
            <span className="block text-xs text-fg-muted">White background, for printing</span>
          </a>
          {note && <p className="border-t border-line px-3 pb-1 pt-2 text-xs text-fg-muted">{note}</p>}
        </div>
      )}
    </div>
  );
}
