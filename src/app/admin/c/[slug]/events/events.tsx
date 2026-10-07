"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, Notice, inputClass } from "@/components/form";
import { formatDay } from "@/lib/dates";
import type { EventEntry } from "@/lib/data/commentary";
import type { EventState } from "./actions";

export function Events({
  events,
  today,
  save,
  remove,
  demo,
}: {
  events: EventEntry[];
  today: string;
  save: (prev: EventState, form: FormData) => Promise<EventState>;
  remove: (id: string) => Promise<EventState>;
  demo: boolean;
}) {
  const [editing, setEditing] = useState<EventEntry | null>(null);
  // React resets the form after a successful action; leave edit mode too.
  const [state, action, pending] = useActionState(async (prev: EventState, form: FormData) => {
    const result = await save(prev, form);
    if (result.status === "done") setEditing(null);
    return result;
  }, { status: "idle" });
  const [removing, startRemove] = useTransition();
  const [removeMsg, setRemoveMsg] = useState<EventState | null>(null);

  return (
    <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-[320px_1fr]">
      <form
        key={editing?.id ?? "new"}
        action={action}
        className="space-y-4 self-start rounded-xl border border-line bg-surface p-5"
      >
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-secondary">{editing ? "Edit event" : "Add an event"}</h2>
        {editing && <input type="hidden" name="id" value={editing.id} />}
        <Field label="Date" htmlFor="event-date">
          <input id="event-date" name="date" type="date" required max={today} defaultValue={editing?.date ?? ""} className={inputClass} />
        </Field>
        <Field label="What happened" htmlFor="event-label" hint="Short, shown on charts. For example: Moved budget from Google Ads to Meta Ads">
          <input id="event-label" name="label" required maxLength={140} defaultValue={editing?.label ?? ""} className={inputClass} />
        </Field>
        <Field label="Details (optional)" htmlFor="event-description">
          <textarea id="event-description" name="description" rows={3} maxLength={1000} defaultValue={editing?.description ?? ""} className={inputClass} />
        </Field>
        {state.status === "error" && <Notice tone="error">{state.message}</Notice>}
        {state.status === "done" && <Notice tone="success">{state.message}</Notice>}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || demo}>
            {pending ? "Saving..." : editing ? "Save changes" : "Add event"}
          </Button>
          {editing && (
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          )}
        </div>
        {demo && <p className="text-xs text-fg-muted">Demo mode: connect Supabase to save events.</p>}
      </form>

      <div className="min-w-0">
        {removeMsg?.status === "error" && (
          <div className="mb-4">
            <Notice tone="error">{removeMsg.message}</Notice>
          </div>
        )}
        {events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-8 text-sm text-fg-secondary">No events yet.</p>
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-6">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span aria-hidden className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-teal bg-page" />
                <div className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wider text-teal">{formatDay(e.date)}</p>
                      <p className="mt-1 font-medium text-fg">{e.label}</p>
                      {e.description && <p className="mt-1 text-sm text-fg-secondary">{e.description}</p>}
                      {e.author && <p className="mt-2 text-xs text-fg-muted">Added by {e.author}</p>}
                    </div>
                    {!demo && (
                      <div className="flex gap-3 text-sm">
                        <button type="button" onClick={() => setEditing(e)} className="text-fg-secondary hover:text-fg">
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={removing}
                          onClick={() => {
                            if (!window.confirm(`Remove "${e.label}"? It disappears from every chart.`)) return;
                            startRemove(async () => setRemoveMsg(await remove(e.id)));
                          }}
                          className="text-fg-secondary hover:text-negative"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
