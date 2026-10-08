import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { cronAuthorized } from "./cron-auth";
import { ga4ErrorMessage, ga4Requests, mapGa4Report } from "./ga4-map";
import { signedAssertion } from "./google-auth";
import { parsePropertyId } from "./property-id";
import { clipRange, replaceWindow, syncWindow } from "./sync-plan";

describe("GA4 reports", () => {
  it("asks for daily totals once and whole months for every month touched", () => {
    const reqs = ga4Requests({ start: "2026-09-08", end: "2026-10-07" });
    expect(reqs.filter((r) => r.id === "daily")).toHaveLength(1);
    const months = reqs.filter((r) => r.id === "month-users").map((r) => r.period);
    expect(months).toEqual([
      { start: "2026-09-01", end: "2026-09-30" },
      { start: "2026-10-01", end: "2026-10-07" },
    ]);
  });

  it("maps rows to portal metrics", () => {
    const [daily] = ga4Requests({ start: "2026-09-01", end: "2026-09-30" });
    const out = mapGa4Report(daily, {
      dimensionHeaders: [{ name: "date" }],
      metricHeaders: [{ name: "sessions" }, { name: "totalUsers" }],
      rows: [{ dimensionValues: [{ value: "20260903" }], metricValues: [{ value: "120" }, { value: "95" }] }],
    });
    expect(out.daily).toEqual([
      { source: "ga4", metric_key: "ga4_sessions", date: "2026-09-03", value: 120, dimension: "", dimension_value: "" },
      { source: "ga4", metric_key: "ga4_users", date: "2026-09-03", value: 95, dimension: "", dimension_value: "" },
    ]);
  });

  it("stores channels and pages by dimension and skips (not set)", () => {
    const reqs = ga4Requests({ start: "2026-09-01", end: "2026-09-30" });
    const landing = reqs.find((r) => r.id === "month-landing")!;
    const out = mapGa4Report(landing, {
      dimensionHeaders: [{ name: "landingPage" }],
      metricHeaders: [{ name: "sessions" }],
      rows: [
        { dimensionValues: [{ value: "/roofing" }], metricValues: [{ value: "40" }] },
        { dimensionValues: [{ value: "(not set)" }], metricValues: [{ value: "3" }] },
      ],
    });
    expect(out.daily).toEqual([]);
    expect(out.period).toEqual([
      { source: "ga4", metric_key: "ga4_sessions", period_start: "2026-09-01", period_end: "2026-09-30", value: 40, dimension: "landing_page", dimension_value: "/roofing" },
    ]);
    const channel = reqs.find((r) => r.id === "daily-channel")!;
    const c = mapGa4Report(channel, {
      dimensionHeaders: [{ name: "date" }, { name: "sessionDefaultChannelGroup" }],
      metricHeaders: [{ name: "sessions" }],
      rows: [{ dimensionValues: [{ value: "20260901" }, { value: "Organic Search" }], metricValues: [{ value: "12" }] }],
    });
    expect(c.daily[0]).toMatchObject({ dimension: "channel", dimension_value: "Organic Search", date: "2026-09-01" });
  });

  it("explains common errors in plain English", () => {
    expect(ga4ErrorMessage(403, "User does not have sufficient permissions", "bot@x.iam.gserviceaccount.com")).toContain("bot@x.iam.gserviceaccount.com");
    expect(ga4ErrorMessage(403, "Google Analytics Data API has not been used in project 123", null)).toContain("Analytics Data API");
    expect(ga4ErrorMessage(404, "not found", null)).toContain("Property ID");
  });
});

describe("sync dates", () => {
  it("pulls complete days only", () => {
    expect(syncWindow("recent", "2026-10-08")).toEqual({ start: "2026-09-08", end: "2026-10-07" });
    expect(syncWindow("history", "2026-10-08")).toEqual({ start: "2025-09-01", end: "2026-10-07" });
    expect(clipRange({ start: "2026-09-01", end: "2026-12-31" }, "2026-10-08")).toEqual({ start: "2026-09-01", end: "2026-10-07" });
    expect(clipRange({ start: "2026-10-08", end: "2026-10-20" }, "2026-10-08")).toBeNull();
  });

  it("replaces monthly rows from the first of the month", () => {
    expect(replaceWindow({ start: "2026-09-08", end: "2026-10-07" }).period).toEqual({ start: "2026-09-01", end: "2026-10-07" });
  });
});

describe("property ID", () => {
  it("accepts the numeric ID only", () => {
    expect(parsePropertyId(" 412345678 ")).toBe("412345678");
    expect(parsePropertyId("properties/412345678")).toBe("412345678");
    expect(parsePropertyId("G-ABC123XYZ")).toBeNull();
  });
});

describe("Google sign-in", () => {
  it("signs a read-only token request that Google can verify", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = signedAssertion({ client_email: "bot@x.iam.gserviceaccount.com", private_key: pem }, "https://www.googleapis.com/auth/analytics.readonly", 1000);
    const [h, c, sig] = jwt.split(".");
    const claims = JSON.parse(Buffer.from(c, "base64url").toString());
    expect(claims).toMatchObject({ iss: "bot@x.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/analytics.readonly", iat: 1000, exp: 4600 });
    const verify = createVerify("RSA-SHA256");
    verify.update(`${h}.${c}`);
    expect(verify.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("nightly job", () => {
  const secret = "a-long-random-cron-secret";
  it("only runs with the exact secret", () => {
    expect(cronAuthorized(`Bearer ${secret}`, secret)).toBe(true);
    expect(cronAuthorized(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronAuthorized(null, secret)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer short", "short")).toBe(false);
  });
});
