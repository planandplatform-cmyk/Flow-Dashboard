/**
 * The short "your report is ready" email an admin copies from client
 * Settings. Pure, so the wording is unit tested. Copy rule: no em dashes.
 */

/** The client walkthrough video (unlisted on YouTube). Override with WALKTHROUGH_VIDEO_URL. */
export const DEFAULT_WALKTHROUGH_URL = "https://youtu.be/rSR1-UpmkDI";

export interface ShareEmailInput {
  clientName: string;
  firstName: string;
  monthLabel: string;
  reportUrl: string;
  videoUrl: string | null;
  senderName: string;
}

export function buildShareEmail(i: ShareEmailInput): { subject: string; body: string } {
  const greeting = i.firstName.trim() ? `Hi ${i.firstName.trim()},` : "Hi there,";
  const lines = [
    greeting,
    "",
    `Your ${i.monthLabel} performance report for ${i.clientName} is ready:`,
    i.reportUrl,
    "",
    "Sign in with your email address and we'll send you a secure sign-in link. No password needed.",
  ];
  if (i.videoUrl) lines.push("", `New to the portal? This short walkthrough shows you around: ${i.videoUrl}`);
  const signature = i.senderName.trim() ? [i.senderName.trim(), "Flow Forward Media"] : ["The Flow Forward Media team"];
  lines.push("", "Let us know if you have any questions.", "", ...signature);
  return { subject: `Your ${i.monthLabel} report is ready`, body: lines.join("\n") };
}

export interface WelcomeEmailInput {
  clientName: string;
  firstName: string;
  loginUrl: string;
  videoUrl: string | null;
  /** The client's channels, in plain words ("Website", "Facebook"...). */
  channels: string[];
  senderName: string;
  /** Website (GA4) is one of their channels: this month's numbers update nightly. */
  hasWebsite: boolean;
  /** Social media or ads channels, which are added at the end of each month. */
  hasSocialOrAds: boolean;
  /** Brand new client with no full month reported yet. */
  isNew: boolean;
  /** Last month's report, the complete one. */
  lastMonthLabel: string;
  lastMonthUrl: string;
}

/** When each part of the report is updated, for this client. */
export function updateNotes(i: Pick<WelcomeEmailInput, "hasWebsite" | "hasSocialOrAds" | "isNew" | "lastMonthLabel" | "lastMonthUrl">): string[] {
  const lines = ["How your report updates:"];
  if (i.hasWebsite) {
    lines.push("• Your website numbers for this month update every night, so you can check in any time.");
    if (i.isNew && i.hasSocialOrAds) lines.push("• Your first full report, with every channel, will be ready in about 30 days.");
    else lines.push(`• For complete reporting, open last month's report (${i.lastMonthLabel}): ${i.lastMonthUrl}`);
  } else if (i.isNew) {
    lines.push("• Your first full report will be ready in about 30 days, so check back then.");
  } else {
    lines.push(`• For your complete report, open last month's report (${i.lastMonthLabel}): ${i.lastMonthUrl}`);
  }
  if (i.hasSocialOrAds) lines.push("• Social media and ad results are added at the end of each month.");
  return lines;
}

const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);

/** The first email a client gets: what the portal is, what it does, and how to get in. */
export function buildWelcomeEmail(i: WelcomeEmailInput): { subject: string; body: string } {
  const greeting = i.firstName.trim() ? `Hi ${i.firstName.trim()},` : "Hi there,";
  const covers = i.channels.length ? `your ${list(i.channels)} results` : "your marketing results";
  const lines = [
    greeting,
    "",
    `Welcome to your new client portal for ${i.clientName}. It runs on proprietary data software built by Flow Forward Media, so ${covers} live in one place, updated for you.`,
    "",
    "Moving forward, this is where you'll find all of your analytics and monthly reports.",
    "",
    "What you can do:",
    "• See every month at a glance: your headline numbers, what changed, and why it matters",
    "• Compare with last month and follow 12-month trends",
    "• Tap the ? next to any number for a plain-language explanation",
    "• Read our written summary of each month's results",
    "• Download any report as a PDF to share with your team",
    "",
    ...updateNotes(i),
    "",
    "Your data is private. Only the people invited from your business can see it.",
    "",
    "Sign in here:",
    i.loginUrl,
    "Enter your email address and we'll send you a secure sign-in link. No password needed.",
  ];
  if (i.videoUrl) lines.push("", "Need a hand getting started? This short walkthrough shows you around:", i.videoUrl);
  const signature = i.senderName.trim() ? [i.senderName.trim(), "Flow Forward Media"] : ["The Flow Forward Media team"];
  lines.push("", "We're glad to have you. Reach out any time with questions.", "", ...signature);
  return { subject: `Welcome to your Flow Forward Media client portal`, body: lines.join("\n") };
}

/** A Gmail compose window with the email filled in. */
export function gmailComposeUrl(to: string[], subject: string, body: string): string {
  const q = new URLSearchParams({ view: "cm", fs: "1", to: to.join(","), su: subject, body });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
