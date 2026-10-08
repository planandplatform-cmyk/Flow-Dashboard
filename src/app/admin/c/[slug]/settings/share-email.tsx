"use client";

import { useMemo, useState } from "react";
import { Button, Field, inputClass } from "@/components/form";
import { buildShareEmail } from "@/lib/clients/share-email";

/** Copy a short "your report is ready" email with the report link and walkthrough video. */
export function ShareEmail({
  clientName,
  reportBase,
  months,
  defaultMonth,
  recipients,
  videoUrl,
  senderName,
}: {
  clientName: string;
  reportBase: string;
  months: { value: string; label: string }[];
  defaultMonth: string;
  recipients: string[];
  videoUrl: string | null;
  senderName: string;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [firstName, setFirstName] = useState("");
  const [copied, setCopied] = useState<"" | "subject" | "body">("");
  const monthLabel = months.find((m) => m.value === month)?.label ?? month;
  const email = useMemo(
    () => buildShareEmail({ clientName, firstName, monthLabel, reportUrl: `${reportBase}?month=${month}`, videoUrl, senderName }),
    [clientName, firstName, monthLabel, reportBase, month, videoUrl, senderName],
  );
  const [body, setBody] = useState<string | null>(null);
  const text = body ?? email.body;
  const copy = (what: "subject" | "body", value: string) =>
    navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    });
  const mailto = `mailto:${recipients.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(text)}`;

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5 text-sm">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Report month" htmlFor="share-month">
          <select
            id="share-month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setBody(null);
            }}
            className={inputClass}
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Their first name" htmlFor="share-name" hint="Optional. Leave blank for “Hi there”.">
          <input
            id="share-name"
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setBody(null);
            }}
            className={inputClass}
            placeholder="Dana"
          />
        </Field>
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-fg-secondary">Subject</p>
        <div className="mt-2 flex items-center gap-2">
          <p className="flex-1 rounded-lg bg-raised px-3 py-2.5 text-fg">{email.subject}</p>
          <Button type="button" variant="secondary" onClick={() => copy("subject", email.subject)}>
            {copied === "subject" ? "Copied" : "Copy"}
          </Button>
        </div>
      </div>

      <Field label="Message" htmlFor="share-body" hint="You can edit it here before copying.">
        <textarea id="share-body" rows={12} value={text} onChange={(e) => setBody(e.target.value)} className={`${inputClass} font-sans leading-relaxed`} />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => copy("body", text)}>
          {copied === "body" ? "Copied" : "Copy message"}
        </Button>
        <a
          href={mailto}
          className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-fg-secondary transition hover:border-line-focus hover:text-fg"
        >
          Open in email app
        </a>
      </div>
      <p className="text-xs text-fg-muted">
        {recipients.length
          ? `"Open in email app" addresses it to this client's ${recipients.length === 1 ? "login" : `${recipients.length} logins`}.`
          : "Invite someone under Logins first so they can sign in with the link."}
      </p>
    </div>
  );
}
