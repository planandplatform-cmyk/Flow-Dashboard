"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import type { Draft } from "@/lib/commentary/drafter";
import type { MonthFacts } from "@/lib/commentary/facts";
import type { EditableCommentary } from "@/lib/data/commentary";
import { draftWithAI, saveCommentary, type CommentaryFields } from "./actions";

interface Props {
  slug: string;
  month: string;
  monthLabel: string;
  months: { value: string; label: string; status: "draft" | "published" | null }[];
  initial: EditableCommentary | null;
  platforms: { id: string; label: string }[];
  notes: { id: string; label: string }[];
  facts: MonthFacts;
  aiConfigured: boolean;
  demo: boolean;
}

function fromSaved(c: EditableCommentary | null): CommentaryFields {
  return {
    headline: c?.headline ?? "",
    summary: c?.summary ?? "",
    platforms: Object.fromEntries(
      Object.entries(c?.platform_narratives ?? {}).map(([k, v]) => [k, { headline: v?.headline ?? "", body: v?.body ?? "" }]),
    ),
    notes: { ...(c?.section_notes ?? {}) },
    conclusion: c?.conclusion ?? "",
  };
}

function fromDraft(d: Draft): CommentaryFields {
  return {
    headline: d.headline,
    summary: d.summary,
    platforms: Object.fromEntries(d.platforms.map((p) => [p.section_id, { headline: p.headline, body: p.body }])),
    notes: Object.fromEntries(Object.entries(d.section_notes).filter((e): e is [string, string] => Boolean(e[1]))),
    conclusion: d.conclusion,
  };
}

const isEmpty = (f: CommentaryFields) =>
  !f.headline && !f.summary && !f.conclusion && !Object.values(f.platforms).some((p) => p.headline || p.body) && !Object.values(f.notes).some(Boolean);

export function CommentaryEditor(props: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<CommentaryFields>(() => fromSaved(props.initial));
  const [status, setStatus] = useState<"draft" | "published" | null>(props.initial?.status ?? null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(null);
  const [email, setEmail] = useState<Draft["recap_email"] | null>(null);
  const [copied, setCopied] = useState(false);
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();
  const busy = drafting || saving;

  const update = (patch: Partial<CommentaryFields>) => {
    setFields((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setPlatform = (id: string, key: "headline" | "body", value: string) =>
    update({
      platforms: {
        ...fields.platforms,
        [id]: { headline: fields.platforms[id]?.headline ?? "", body: fields.platforms[id]?.body ?? "", [key]: value },
      },
    });

  function draft() {
    if (!isEmpty(fields) && !window.confirm("Replace what is in the editor with a new AI draft? Nothing is saved until you save.")) return;
    setMessage(null);
    startDraft(async () => {
      const res = await draftWithAI(props.slug, props.month);
      if (res.status === "error") return setMessage({ tone: "error", text: res.message });
      setFields(fromDraft(res.draft));
      setEmail(res.draft.recap_email);
      setDirty(true);
      setMessage({ tone: "info", text: "Draft ready. Check every sentence against the numbers on the right, edit, then save or publish." });
    });
  }

  function save(intent: "draft" | "publish" | "unpublish") {
    if (intent === "publish" && !window.confirm(`Publish the ${props.monthLabel} commentary? The client will see it right away.`)) return;
    setMessage(null);
    startSave(async () => {
      const res = await saveCommentary(props.slug, props.month, intent, fields);
      if (res.status === "error") return setMessage({ tone: "error", text: res.message });
      setStatus(res.savedStatus);
      setDirty(false);
      setMessage({ tone: "success", text: res.message });
    });
  }

  async function copyEmail() {
    if (!email) return;
    await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const area = `${inputClass} leading-relaxed`;

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 flex-1 sm:max-w-xs">
            <Field label="Month" htmlFor="month">
              <select
                id="month"
                value={props.month.slice(0, 7)}
                onChange={(e) => {
                  if (dirty && !window.confirm("You have unsaved changes. Switch months anyway?")) return;
                  router.push(`?month=${e.target.value}`);
                }}
                className={inputClass}
              >
                {props.months.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                    {m.status === "published" ? " · Published" : m.status === "draft" ? " · Draft" : ""}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <StatusChip status={status} dirty={dirty} />
          <Link href={`/c/${props.slug}?month=${props.month.slice(0, 7)}`} target="_blank" className="ml-auto self-center text-sm text-teal hover:text-teal-200">
            Preview report ↗
          </Link>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line-focus bg-teal-950/60 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Draft with AI</p>
            <p className="text-xs text-teal-100">
              Writes a first draft from {props.monthLabel}&apos;s numbers compared with the month before, in Flow Forward Media&apos;s voice. Nothing is saved
              until you save.
            </p>
          </div>
          <Button type="button" onClick={draft} disabled={busy || !props.aiConfigured}>
            {drafting ? "Writing..." : "Draft with AI"}
          </Button>
          {!props.aiConfigured && <p className="w-full text-xs text-fg-secondary">Add ANTHROPIC_API_KEY to the environment variables to turn this on.</p>}
        </div>

        {drafting && <Notice tone="info">Writing the draft. This usually takes 20 to 60 seconds.</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        <Section title="Executive summary">
          <Field label="Headline" htmlFor="headline" hint="The single biggest takeaway, six to twelve words.">
            <input id="headline" value={fields.headline} onChange={(e) => update({ headline: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Summary" htmlFor="summary" hint="Two or three short paragraphs. Leave a blank line between paragraphs.">
            <textarea id="summary" rows={9} value={fields.summary} onChange={(e) => update({ summary: e.target.value })} className={area} />
          </Field>
        </Section>

        {props.platforms.length > 0 && (
          <Section title="Channels">
            {props.platforms.map((p) => (
              <div key={p.id} className="space-y-3 border-l-2 border-teal-800 pl-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-teal">{p.label}</p>
                <input
                  aria-label={`${p.label} headline`}
                  placeholder="Headline, led by the most important number"
                  value={fields.platforms[p.id]?.headline ?? ""}
                  onChange={(e) => setPlatform(p.id, "headline", e.target.value)}
                  className={inputClass}
                />
                <textarea
                  aria-label={`${p.label} narrative`}
                  placeholder="Two to four sentences"
                  rows={3}
                  value={fields.platforms[p.id]?.body ?? ""}
                  onChange={(e) => setPlatform(p.id, "body", e.target.value)}
                  className={area}
                />
              </div>
            ))}
          </Section>
        )}

        <Section title="Section notes" hint="Optional. Each appears at the top of its section in the report.">
          {props.notes.map((n) => (
            <Field key={n.id} label={n.label} htmlFor={`note-${n.id}`}>
              <textarea
                id={`note-${n.id}`}
                rows={2}
                value={fields.notes[n.id] ?? ""}
                onChange={(e) => update({ notes: { ...fields.notes, [n.id]: e.target.value } })}
                className={area}
              />
            </Field>
          ))}
        </Section>

        <Section title="Conclusion">
          <textarea aria-label="Conclusion" rows={4} value={fields.conclusion} onChange={(e) => update({ conclusion: e.target.value })} className={area} />
        </Section>

        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-page/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5">
          {status === "published" ? (
            <>
              <Button type="button" onClick={() => save("publish")} disabled={busy || props.demo || !dirty}>
                {saving ? "Saving..." : "Update published"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => save("unpublish")} disabled={busy || props.demo}>
                Unpublish
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => save("draft")} disabled={busy || props.demo}>
                {saving ? "Saving..." : "Save draft"}
              </Button>
              <Button type="button" onClick={() => save("publish")} disabled={busy || props.demo}>
                Publish
              </Button>
            </>
          )}
          <p className="text-xs text-fg-muted">
            {props.demo ? "Demo mode: connect Supabase to save." : "Clients only see published commentary. Em dashes are replaced with commas on save."}
          </p>
        </div>

        {email && (
          <Section title="Recap email" hint="Not sent automatically. Copy it into your email when the report is published.">
            <div className="rounded-lg border border-line bg-raised p-4 text-sm leading-relaxed">
              <p className="font-semibold text-fg">Subject: {email.subject}</p>
              <p className="mt-3 whitespace-pre-line text-fg-secondary">{email.body}</p>
            </div>
            <Button type="button" variant="secondary" onClick={copyEmail}>
              {copied ? "Copied" : "Copy email"}
            </Button>
          </Section>
        )}
      </div>

      <FactsPanel facts={props.facts} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-secondary">{title}</h2>
        {hint && <p className="mt-1 text-xs text-fg-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function StatusChip({ status, dirty }: { status: "draft" | "published" | null; dirty: boolean }) {
  const label = status === "published" ? "Published" : status === "draft" ? "Draft" : "Not started";
  const tone = status === "published" ? "border-teal-800 bg-teal-950 text-teal" : "border-line bg-raised text-fg-secondary";
  return (
    <span className="flex items-center gap-2 self-center pb-1">
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>{label}</span>
      {dirty && <span className="text-xs text-fg-muted">Unsaved changes</span>}
    </span>
  );
}

/** The numbers the draft is written from, so every sentence can be checked. */
function FactsPanel({ facts }: { facts: MonthFacts }) {
  return (
    <aside className="self-start lg:sticky lg:top-24">
      <details open className="rounded-xl border border-line bg-surface">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-semibold text-fg">
          {facts.monthLabel} numbers <span className="font-normal text-fg-muted">vs {facts.previousLabel}</span>
        </summary>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto border-t border-line px-5 py-4 text-sm">
          {facts.sections.length === 0 && <p className="text-fg-secondary">No data for this month yet.</p>}
          {facts.sections.map((s) => (
            <div key={s.id}>
              <p className="text-xs font-semibold uppercase tracking-widest text-teal">{s.label}</p>
              {s.id === "meta_ads" && <p className="text-xs text-fg-muted">{s.window}</p>}
              <dl className="mt-2 space-y-1.5">
                {s.metrics.map((m) => (
                  <div key={m.key} className="flex items-baseline justify-between gap-3">
                    <dt className="text-fg-secondary">{m.label}</dt>
                    <dd className="text-right tabular-nums">
                      <span className="font-medium text-fg">{m.value}</span>
                      {m.change && (
                        <span
                          className={`ml-2 text-xs ${m.sentiment === "positive" ? "text-positive" : m.sentiment === "negative" ? "text-negative" : "text-fg-muted"}`}
                        >
                          {m.change.split(" ")[0]}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
          {facts.events.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-teal">Events</p>
              <ul className="mt-2 space-y-1 text-fg-secondary">
                {facts.events.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </aside>
  );
}
