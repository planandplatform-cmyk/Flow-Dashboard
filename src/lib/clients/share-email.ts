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
