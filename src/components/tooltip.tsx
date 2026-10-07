"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const WIDTH = 256;
const GAP = 8;
const EDGE = 12;

/**
 * Small "?" tooltip. Rendered in a portal with fixed positioning so it is
 * never clipped by scrolling tables and never widens the page on phones.
 * Opens on hover, keyboard focus, or tap; closes on Escape or tapping away.
 */
export function Tooltip({ title, text }: { title: string; text: string }) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const btn = buttonRef.current;
    const tip = tipRef.current;
    if (!btn || !tip) return;
    const b = btn.getBoundingClientRect();
    const width = Math.min(WIDTH, window.innerWidth - EDGE * 2);
    const left = Math.min(Math.max(b.left + b.width / 2 - width / 2, EDGE), window.innerWidth - width - EDGE);
    const above = b.top - GAP - tip.offsetHeight;
    const top = above >= EDGE ? above : b.bottom + GAP;
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onPointer = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`What is ${title}?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => !pinned && setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => !pinned && setOpen(false)}
        onClick={() => {
          setPinned((p) => !p);
          setOpen(true);
        }}
        className="ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-fg-muted align-middle text-[10px] font-semibold leading-none text-fg-muted transition hover:border-teal hover:text-teal focus:border-teal focus:text-teal"
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: `min(${WIDTH}px, calc(100vw - ${EDGE * 2}px))` }}
            className="pointer-events-none fixed z-50 rounded-lg border border-line bg-raised p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-fg shadow-xl shadow-black/60"
          >
            <span className="mb-1 block font-semibold text-teal">{title}</span>
            {text}
          </div>,
          document.body,
        )}
    </>
  );
}
