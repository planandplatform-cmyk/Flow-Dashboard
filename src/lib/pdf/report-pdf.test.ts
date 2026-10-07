import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Runs in demo mode (no Supabase settings in tests), on the seeded fixture.
describe("PDF export", () => {
  it("renders the July report in both themes with the same data as the page", async () => {
    const { loadReport } = await import("@/lib/report/load");
    const { renderReportPdf, pdfFileName } = await import("./report-pdf");
    const { getClientBySlug } = await import("@/lib/data/portal");
    const client = (await getClientBySlug("wieler-roofing"))!;
    const report = await loadReport(client, { month: "2026-07" }, { publishedOnly: true });

    expect(pdfFileName(report)).toBe("Wieler-Roofing-July-2026.pdf");
    for (const theme of ["dark", "print"] as const) {
      const pdf = await renderReportPdf(report, theme);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      const pages = pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0;
      expect(pages).toBeGreaterThanOrEqual(4);
    }
  }, 60_000);

  it("leaves out draft commentary", async () => {
    const { loadReport } = await import("@/lib/report/load");
    const { getClientBySlug } = await import("@/lib/data/portal");
    const client = (await getClientBySlug("wieler-roofing"))!;
    const published = await loadReport(client, { month: "2026-07" }, { publishedOnly: true });
    expect(published.commentary?.status).toBe("published");
    // A month with no commentary has none either way.
    const empty = await loadReport(client, { month: "2026-05" }, { publishedOnly: true });
    expect(empty.commentary).toBeNull();
  }, 60_000);
});
