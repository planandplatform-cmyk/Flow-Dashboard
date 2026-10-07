"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Notice, inputClass } from "@/components/form";
import type { Member } from "@/lib/data/admin";
import type { FormState } from "./actions";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

function StatusBadge({ m }: { m: Member }) {
  if (m.status === null) return null;
  return m.status === "active" ? (
    <span className="rounded-full border border-teal-800 bg-teal-950 px-2 py-0.5 text-xs text-teal">Active · last in {when(m.last_sign_in_at)}</span>
  ) : (
    <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-xs text-fg-secondary">Invited, not signed in yet</span>
  );
}

/**
 * List of logins with an invite form. Used for one client's logins and for
 * the FFM team (with a role picker).
 */
export function Members({
  members,
  invite,
  remove,
  resend,
  roles,
  changeRole,
  selfId,
  emptyText,
  inviteLabel,
  demo,
}: {
  members: Member[];
  invite: (prev: FormState, form: FormData) => Promise<FormState>;
  remove?: (userId: string) => Promise<FormState>;
  resend: (email: string) => Promise<FormState>;
  roles?: { value: string; label: string }[];
  changeRole?: (userId: string, role: string) => Promise<FormState>;
  selfId?: string;
  emptyText: string;
  inviteLabel: string;
  demo: boolean;
}) {
  const [state, inviteAction, inviting] = useActionState<FormState, FormData>(invite, { status: "idle" });
  const [rowMessage, setRowMessage] = useState<FormState>({ status: "idle" });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<FormState>) => start(async () => setRowMessage(await fn()));

  return (
    <div className="space-y-5">
      {rowMessage.status !== "idle" && <Notice tone={rowMessage.status === "done" ? "success" : "error"}>{rowMessage.message}</Notice>}

      {members.length === 0 ? (
        <p className="text-sm text-fg-secondary">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">
                  {m.email}
                  {m.id === selfId && <span className="text-fg-muted"> (you)</span>}
                </p>
                <div className="mt-1">
                  <StatusBadge m={m} />
                </div>
              </div>
              {roles && changeRole && (
                <select
                  aria-label={`Role for ${m.email}`}
                  value={m.role}
                  disabled={pending || demo || m.id === selfId}
                  onChange={(e) => run(() => changeRole(m.id, e.target.value))}
                  className={`${inputClass} w-auto py-1.5`}
                >
                  {roles.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                  <option value="client_viewer">Remove from team</option>
                </select>
              )}
              {m.status === "invited" && (
                <Button variant="secondary" className="px-3 py-1.5" disabled={pending || demo} onClick={() => run(() => resend(m.email))}>
                  Resend link
                </Button>
              )}
              {remove &&
                (confirming === m.id ? (
                  <span className="flex gap-2">
                    <Button variant="danger" className="px-3 py-1.5" disabled={pending} onClick={() => {
                        setConfirming(null);
                        run(() => remove(m.id));
                      }}>
                      Remove access
                    </Button>
                    <Button variant="secondary" className="px-3 py-1.5" onClick={() => setConfirming(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="secondary" className="px-3 py-1.5" disabled={demo} onClick={() => setConfirming(m.id)}>
                    Remove
                  </Button>
                ))}
            </li>
          ))}
        </ul>
      )}

      <form action={inviteAction} className="rounded-xl border border-line bg-surface p-4">
        <label htmlFor="invite-email" className="block text-xs font-medium uppercase tracking-wider text-fg-secondary">
          {inviteLabel}
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <input id="invite-email" name="email" type="email" required placeholder="name@company.com" className={`${inputClass} min-w-0 flex-1`} />
          {roles && (
            <select name="role" aria-label="Role" defaultValue={roles[roles.length - 1].value} className={`${inputClass} w-auto`}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" disabled={inviting || demo}>
            {inviting ? "Sending..." : "Send invite"}
          </Button>
        </div>
        {state.status === "error" && <p className="mt-2 text-sm text-negative">{state.message}</p>}
        {state.status === "done" && <p className="mt-2 text-sm text-teal">{state.message}</p>}
      </form>
    </div>
  );
}
