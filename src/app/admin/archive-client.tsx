"use client";

import { useState, useTransition } from "react";
import { Button, Notice } from "@/components/form";
import type { FormState } from "./actions";

export function ArchiveClient({ archived, action, demo }: { archived: boolean; action: (archived: boolean) => Promise<FormState>; demo: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const [state, setState] = useState<FormState>({ status: "idle" });
  const [pending, start] = useTransition();
  const run = (value: boolean) => start(async () => setState(await action(value)));

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-5 text-sm">
      {state.status !== "idle" && <Notice tone={state.status === "done" ? "success" : "error"}>{state.message}</Notice>}
      {archived ? (
        <>
          <p className="text-fg-secondary">This client is archived. Restore it to show it in lists and give its logins access again.</p>
          <Button variant="secondary" disabled={pending || demo} onClick={() => run(false)}>
            Restore client
          </Button>
        </>
      ) : (
        <>
          <p className="text-fg-secondary">
            Archiving hides the client from lists and stops its logins from seeing anything. Nothing is deleted, and it can be restored.
          </p>
          {confirm ? (
            <div className="flex gap-2">
              <Button variant="danger" disabled={pending} onClick={() => run(true)}>
                {pending ? "Archiving..." : "Yes, archive"}
              </Button>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="danger" disabled={demo} onClick={() => setConfirm(true)}>
              Archive client
            </Button>
          )}
        </>
      )}
    </div>
  );
}
