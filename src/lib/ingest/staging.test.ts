import { describe, expect, it, vi } from "vitest";
import { isStagedPath, safeFileName, stagedFolder } from "./staging";

describe("staged uploads", () => {
  const client = "5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01";

  it("only accepts files in this client's staged folder", () => {
    const folder = stagedFolder(client, "batch-1");
    expect(isStagedPath(client, `${folder}/01-abc-insights.png`)).toBe(true);
    expect(isStagedPath("someone-else", `${folder}/01-abc-insights.png`)).toBe(false);
    expect(isStagedPath(client, `${client}/staged/../other/x.png`)).toBe(false);
    expect(isStagedPath(client, `${client}/staged/batch-1/nested/x.png`)).toBe(false);
    expect(isStagedPath(client, `${client}/abc/x.png`)).toBe(false);
  });

  it("keeps file names safe for storage", () => {
    expect(safeFileName("MCWL August 2026 (final).pdf")).toBe("MCWL_August_2026_final_.pdf");
  });

  it("sends staged files to Claude as links, not file data", async () => {
    vi.resetModules();
    const parse = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      parsed_output: { is_analytics_screenshot: true, platform_seen: "linkedin", date_range: null, metrics: [], breakdowns: [], competitors: [], campaign_name: null, notes: [] },
    });
    vi.doMock("server-only", () => ({}));
    vi.doMock("@anthropic-ai/sdk", async () => {
      const actual = await vi.importActual<typeof import("@anthropic-ai/sdk")>("@anthropic-ai/sdk");
      class Fake {
        beta = { messages: { parse } };
      }
      return { ...actual, default: Object.assign(Fake, actual.default) };
    });
    const { readScreenshots } = await import("./screenshot-reader");
    await readScreenshots(
      [
        { url: "https://x.supabase.co/storage/v1/object/sign/uploads/a.png?token=t", mediaType: "image/png" },
        { url: "https://x.supabase.co/storage/v1/object/sign/uploads/b.pdf?token=t", mediaType: "application/pdf" },
      ],
      "linkedin",
      "2026-10-08",
    );
    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content.filter((c: { type: string }) => c.type !== "text").map((c: { type: string; source: { type: string } }) => [c.type, c.source.type])).toEqual([
      ["image", "url"],
      ["document", "url"],
    ]);
  });
});
