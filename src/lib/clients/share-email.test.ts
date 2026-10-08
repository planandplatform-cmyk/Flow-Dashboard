import { describe, expect, it } from "vitest";
import { buildShareEmail, buildWelcomeEmail, gmailComposeUrl, updateNotes } from "./share-email";

describe("report email", () => {
  const base = {
    clientName: "Wieler Roofing",
    firstName: "Dana",
    monthLabel: "September 2026",
    reportUrl: "https://flow-dashboard-phi.vercel.app/c/wieler-roofing?month=2026-09",
    videoUrl: "https://youtu.be/rSR1-UpmkDI",
    senderName: "Alex",
  };

  it("includes the report link, sign-in help and walkthrough", () => {
    const { subject, body } = buildShareEmail(base);
    expect(subject).toBe("Your September 2026 report is ready");
    expect(body).toContain("Hi Dana,");
    expect(body).toContain(base.reportUrl);
    expect(body).toContain("https://youtu.be/rSR1-UpmkDI");
    expect(body).not.toMatch(/—/);
  });

  it("works without a name or video", () => {
    const { body } = buildShareEmail({ ...base, firstName: " ", videoUrl: null, senderName: "" });
    expect(body.startsWith("Hi there,")).toBe(true);
    expect(body).not.toContain("walkthrough");
    expect(body).toContain("The Flow Forward Media team");
  });
});

describe("welcome email", () => {
  it("introduces the portal with their channels, the login link and the walkthrough", () => {
    const { subject, body } = buildWelcomeEmail({
      clientName: "Wieler Roofing",
      firstName: "Dana",
      loginUrl: "https://flow-dashboard-phi.vercel.app/login",
      videoUrl: "https://youtu.be/rSR1-UpmkDI",
      channels: ["Website", "Facebook", "Instagram"],
      senderName: "",
      hasWebsite: true,
      hasSocialOrAds: true,
      isNew: false,
      lastMonthLabel: "September 2026",
      lastMonthUrl: "https://flow-dashboard-phi.vercel.app/c/wieler-roofing?month=2026-09",
    });
    expect(body).toContain("website numbers for this month update every night");
    expect(body).toContain("last month's report (September 2026): https://flow-dashboard-phi.vercel.app/c/wieler-roofing?month=2026-09");
    expect(body).toContain("Social media and ad results are added at the end of each month.");
    expect(subject).toBe("Welcome to your Flow Forward Media client portal");
    expect(body).toContain("proprietary data software built by Flow Forward Media");
    expect(body).toContain("your Website, Facebook and Instagram results");
    expect(body).toContain("Moving forward, this is where you'll find all of your analytics");
    expect(body).toContain("https://flow-dashboard-phi.vercel.app/login");
    expect(body).toContain("https://youtu.be/rSR1-UpmkDI");
    expect(body).not.toMatch(/\u2014/);
  });

  it("opens a filled-in Gmail draft", () => {
    const url = new URL(gmailComposeUrl(["a@x.com", "b@x.com"], "Hi & welcome", "Line 1\nLine 2"));
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("to")).toBe("a@x.com,b@x.com");
    expect(url.searchParams.get("su")).toBe("Hi & welcome");
    expect(url.searchParams.get("body")).toBe("Line 1\nLine 2");
  });
});

describe("report update notes", () => {
  const last = { lastMonthLabel: "September 2026", lastMonthUrl: "https://x/c/a?month=2026-09" };
  const text = (o: { hasWebsite: boolean; hasSocialOrAds: boolean; isNew: boolean }) => updateNotes({ ...o, ...last }).join("\n");

  it("points non-website clients to last month's report", () => {
    const t = text({ hasWebsite: false, hasSocialOrAds: true, isNew: false });
    expect(t).not.toContain("every night");
    expect(t).toContain("For your complete report, open last month's report (September 2026)");
    expect(t).toContain("end of each month");
  });

  it("tells brand new non-website clients to check back in 30 days", () => {
    const t = text({ hasWebsite: false, hasSocialOrAds: true, isNew: true });
    expect(t).toContain("about 30 days");
    expect(t).not.toContain("last month's report");
  });

  it("website-only clients get nightly updates and no social note", () => {
    const t = text({ hasWebsite: true, hasSocialOrAds: false, isNew: true });
    expect(t).toContain("every night");
    expect(t).toContain("last month's report");
    expect(t).not.toContain("end of each month");
  });
});
