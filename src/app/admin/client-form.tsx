"use client";

import { useActionState, useState } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import { SOURCE_DESCRIPTIONS, TIMEZONES, slugify } from "@/lib/clients/form";
import { DATA_SOURCES, SOURCE_LABELS } from "@/lib/metrics/types";
import type { FormState } from "./actions";

export interface ClientFormInitial {
  name: string;
  slug: string;
  market: string | null;
  timezone: string;
  brand_color: string | null;
  logo_url: string | null;
  enabled_sources: string[];
}

export function ClientForm({
  action,
  initial,
  mode,
  demo,
}: {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  initial?: ClientFormInitial;
  mode: "create" | "edit";
  demo: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(mode === "edit");
  const [color, setColor] = useState(initial?.brand_color ?? "");
  const fields = state.status === "error" ? (state.fields ?? {}) : {};
  const err = (k: keyof typeof fields) =>
    fields[k] ? <p className="mt-1.5 text-xs text-negative">{fields[k]}</p> : null;
  const shownSlug = slugTouched ? slug : slugify(name);

  return (
    <form action={formAction} className="space-y-8">
      {state.status === "error" && <Notice tone="error">{state.message}</Notice>}
      {state.status === "done" && <Notice tone="success">{state.message}</Notice>}
      {demo && <Notice tone="info">Demo mode: you can look around, but changes are saved once Supabase is connected.</Notice>}

      <section className="space-y-5 rounded-xl border border-line bg-surface p-5">
        <h2 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Business</h2>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label="Business name" htmlFor="name">
            <input id="name" name="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            {err("name")}
          </Field>
          <Field
            label="Web address"
            htmlFor="slug"
            hint={mode === "edit" ? "Fixed so saved links keep working." : `The report will live at /c/${shownSlug || "..."}`}
          >
            <input
              id="slug"
              name="slug"
              value={shownSlug}
              disabled={mode === "edit"}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className={`${inputClass} font-mono`}
            />
            {err("slug")}
          </Field>
          <Field label="Market" htmlFor="market" hint="Used in AI-drafted commentary, e.g. West Texas.">
            <input id="market" name="market" defaultValue={initial?.market ?? ""} className={inputClass} />
            {err("market")}
          </Field>
          <Field label="Time zone" htmlFor="timezone">
            <select id="timezone" name="timezone" defaultValue={initial?.timezone ?? "America/Chicago"} className={inputClass}>
              {TIMEZONES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            {err("timezone")}
          </Field>
          <Field label="Logo link (optional)" htmlFor="logo_url" hint="A link to the client's logo image, starting with https://">
            <input id="logo_url" name="logo_url" type="url" defaultValue={initial?.logo_url ?? ""} placeholder="https://" className={inputClass} />
            {err("logo_url")}
          </Field>
          <Field label="Brand color (optional)" htmlFor="brand_color">
            <div className="flex gap-2">
              <input
                aria-label="Pick brand color"
                type="color"
                value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#31e4e4"}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-11 w-14 cursor-pointer rounded-lg border border-line bg-raised p-1"
              />
              <input
                id="brand_color"
                name="brand_color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#31E4E4"
                className={`${inputClass} font-mono`}
              />
            </div>
            {err("brand_color")}
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Channels</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Turn on what this client uses. Their report only shows these, and data can only be uploaded for them.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {DATA_SOURCES.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer gap-3 rounded-lg border border-line bg-raised p-4 transition hover:border-line-focus has-[:checked]:border-teal-700 has-[:checked]:bg-teal-950"
            >
              <input
                type="checkbox"
                name="enabled_sources"
                value={s}
                defaultChecked={initial?.enabled_sources.includes(s)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-teal)]"
              />
              <span>
                <span className="block font-medium text-fg">{SOURCE_LABELS[s]}</span>
                <span className="mt-0.5 block text-xs text-fg-secondary">{SOURCE_DESCRIPTIONS[s]}</span>
              </span>
            </label>
          ))}
        </div>
        {err("enabled_sources")}
        {mode === "edit" && (
          <p className="text-xs text-fg-muted">Turning a channel off hides it from the report. Its data is kept, so turning it back on restores it.</p>
        )}
      </section>

      <Button type="submit" disabled={pending || demo}>
        {pending ? "Saving..." : mode === "create" ? "Create client" : "Save changes"}
      </Button>
    </form>
  );
}
