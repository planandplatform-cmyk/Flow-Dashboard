import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalRedirect } from "./proxy";

const req = (url: string) => new NextRequest(url);

describe("production address", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends other production addresses to SITE_URL, keeping the path", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SITE_URL", "https://flow-dashboard-phi.vercel.app");
    const r = canonicalRedirect(req("https://flow-dashboard-ffm8.vercel.app/c/sterling?month=2026-09"));
    expect(r?.status).toBe(308);
    expect(r?.headers.get("location")).toBe("https://flow-dashboard-phi.vercel.app/c/sterling?month=2026-09");
  });

  it("leaves the real address, API routes, previews and unset SITE_URL alone", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SITE_URL", "https://flow-dashboard-phi.vercel.app/");
    expect(canonicalRedirect(req("https://flow-dashboard-phi.vercel.app/login"))).toBeNull();
    expect(canonicalRedirect(req("https://flow-dashboard-ffm8.vercel.app/api/cron/sync"))).toBeNull();
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(canonicalRedirect(req("https://flow-dashboard-git-x-ffm8.vercel.app/login"))).toBeNull();
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SITE_URL", "not a url");
    expect(canonicalRedirect(req("https://flow-dashboard-ffm8.vercel.app/login"))).toBeNull();
  });
});
