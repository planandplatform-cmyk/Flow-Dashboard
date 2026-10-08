import { describe, expect, it } from "vitest";
import { buildShareEmail } from "./share-email";

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
