import { NextResponse, type NextRequest } from "next/server";
import { getClientBySlug, getViewer } from "@/lib/data/portal";
import { pdfFileName, renderReportPdf } from "@/lib/pdf/report-pdf";
import { loadReport } from "@/lib/report/load";

/**
 * The report view as a PDF: same URL parameters as the report page, plus
 * theme=print for a white version. Runs as the signed-in user, so row-level
 * security decides what is in it, and only published commentary is included.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/c/[slug]/pdf">) {
  const { slug } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) {
    const next = `/c/${slug}${request.nextUrl.search}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, request.url));
  }
  const client = await getClientBySlug(slug);
  if (!client) return new NextResponse("Not found", { status: 404 });

  const search = Object.fromEntries(request.nextUrl.searchParams);
  const report = await loadReport(client, search, { publishedOnly: true });
  const pdf = await renderReportPdf(report, search.theme === "print" ? "print" : "dark");
  const name = pdfFileName(report).replace(".pdf", search.theme === "print" ? "-print.pdf" : ".pdf");

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${search.inline === "1" ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
