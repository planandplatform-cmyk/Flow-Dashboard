"use client";

import { useMemo, useState } from "react";
import { Button, Field, inputClass } from "@/components/form";
import { buildShareEmail, buildWelcomeEmail, gmailComposeUrl } from "@/lib/clients/share-email";

type Kind = "welcome" | "report";

/** Ready-to-send client emails: a welcome to the portal, and the monthly report link. */
export function ShareEmail({
  clientName,
  reportBase,
  loginUrl,
  channels,
  months,
  defaultMonth,
  recipients,
  videoUrl,
  senderName,
  hasWebsite,
  hasSocialOrAds,
}: {
  clientName: string;
  reportBase: string;
  loginUrl: string;
  channels: string[];
  months: { value: string; label: string }[];
  defaultMonth: string;
  recipients: string[];
  videoUrl: string | null;
  senderName: string;
  hasWebsite: boolean;
  hasSocialOrAds: boolean;
}) {
  const [kind, setKind] = useState<Kind>("welcome");
  const [month, setMonth] = useState(defaultMonth);
  const [firstName, setFirstName] = useState("");
  const [isNew, setIsNew] = useState(false);
  // Last month is the latest complete report.
  const last = months[1] ?? months[0];
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState<"" | "subject" | "body">("");
  const monthLabel = months.find((m) => m.value === month)?.label ?? month;
  const email = useMemo(
    () =>
      kind === "welcome"
        ? buildWelcomeEmail({
            clientName,
            firstName,
            loginUrl,
            videoUrl,
            channels,
            senderName,
            hasWebsite,
            hasSocialOrAds,
            isNew,
            lastMonthLabel: last.label,
            lastMonthUrl: `${reportBase}?month=${last.value}`,
          })
        : buildShareEmail({ clientName, firstName, monthLabel, reportUrl: `${reportBase}?month=${month}`, videoUrl, senderName }),
    [kind, clientName, firstName, loginUrl, videoUrl, channels, senderName, hasWebsite, hasSocialOrAds, isNew, last, monthLabel, reportBase, month],
  );
  const text = edited ?? email.body;
  // Any change to the inputs rebuilds the message, dropping manual edits.
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setEdited(null);
  };
  const copy = (what: "subject" | "body", value: string) =>
    navigator.clipboard.writeText(value).then(() => {
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    });

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-5 text-sm">
      <div role="tablist" aria-label="Email" className="inline-flex rounded-lg border border-line bg-raised p-1">
        {(
          [
            ["welcome", "Welcome email"],
            ["report", "Monthly report email"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            onClick={() => reset(setKind)(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${kind === id ? "bg-teal text-page" : "text-fg-secondary hover:text-fg"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {kind === "report" && (
          <Field label="Report month" htmlFor="share-month">
            <select id="share-month" value={month} onChange={(e) => reset(setMonth)(e.target.value)} className={inputClass}>
              {months.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Their first name" htmlFor="share-name" hint="Optional. Leave blank for “Hi there”.">
          <input id="share-name" value={firstName} onChange={(e) => reset(setFirstName)(e.target.value)} className={inputClass} placeholder="Dana" />
        </Field>
        {kind === "welcome" && (
          <label className="flex items-start gap-3 self-center rounded-lg border border-line bg-raised p-3">
            <input type="checkbox" checked={isNew} onChange={(e) => reset(setIsNew)(e.target.checked)} className="mt-0.5 h-4 w-4 accent-teal" />
            <span>
              <span className="block font-medium text-fg">Brand new client</span>
              <span className="block text-xs text-fg-muted">No full month reported yet. Tells them when their first full report will be ready.</span>
            </span>
          </label>
        )}
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

      <Field label="Message" htmlFor="share-body" hint="You can edit it here before copying or opening Gmail.">
        <textarea
          id="share-body"
          rows={kind === "welcome" ? 22 : 13}
          value={text}
          onChange={(e) => setEdited(e.target.value)}
          className={`${inputClass} font-sans leading-relaxed`}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <a
          href={gmailComposeUrl(recipients, email.subject, text)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-lg bg-teal px-4 py-2.5 text-sm font-semibold text-page transition hover:bg-teal-200"
        >
          Open in Gmail
        </a>
        <Button type="button" variant="secondary" onClick={() => copy("body", text)}>
          {copied === "body" ? "Copied" : "Copy message"}
        </Button>
      </div>
      <p className="text-xs text-fg-muted">
        {recipients.length
          ? `Gmail opens a draft addressed to this client's ${recipients.length === 1 ? "login" : `${recipients.length} logins`}, sent from the Gmail account you're signed in to.`
          : "Invite someone under Logins first so they can sign in."}
      </p>
    </div>
  );
}
