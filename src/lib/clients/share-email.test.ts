import { describe, expect, it } from "vitest";
import { buildShareEmail, buildWelcomeEmail, gmailComposeUrl } from "./share-email";

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
    });
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
