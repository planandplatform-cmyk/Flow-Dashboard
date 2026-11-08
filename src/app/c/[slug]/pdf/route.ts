import { NextResponse, type NextRequest } from "next/server";
import { getClientBySlug, getViewer } from "@/lib/data/portal";
import { pdfFileName, renderReportPdf } from "@/lib/pdf/report-pdf";
import { loadReport } from "@/lib/report/load";

// Larger clients (several channels, a year of synced data) take longer than
// the platform's short default to build.
export const maxDuration = 60;

const escape = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Shown instead of a broken download when the PDF cannot be built. */
function failurePage(slug: string, detail: string): NextResponse {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>PDF not ready | Flow Forward Media</title>
<style>:root{color-scheme:dark}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#000;color:#fff;font-family:Inter,ui-sans-serif,system-ui,sans-serif;padding:16px}
main{max-width:440px}h1{font-size:20px}p{color:#a3a3a3;font-size:14px;line-height:1.5}a{color:#31e4e4}code{display:block;margin-top:12px;color:#737373;font-size:12px;white-space:pre-wrap}</style></head>
<body><main><h1>The PDF could not be created</h1><p>Something went wrong while building this report's PDF. Please try again in a minute. If it keeps happening, send Flow Forward Media a screenshot of this page.</p>
<p><a href="/c/${escape(slug)}">Back to the report</a></p><code>${escape(detail)}</code></main></body></html>`;
  return new NextResponse(html, { status: 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

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
  const started = Date.now();
  let pdf: Buffer;
  let name: string;
  try {
    const report = await loadReport(client, search, { publishedOnly: true });
    pdf = await renderReportPdf(report, search.theme === "print" ? "print" : "dark");
    name = pdfFileName(report).replace(".pdf", search.theme === "print" ? "-print.pdf" : ".pdf");
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    // Visible in Vercel's logs, with the client and how long it ran.
    console.error(`PDF failed for ${slug} after ${Date.now() - started} ms:`, err.stack ?? err.message);
    return failurePage(slug, err.message.slice(0, 300));
  }
  console.info(`PDF built for ${slug} in ${Date.now() - started} ms (${pdf.length} bytes)`);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${search.inline === "1" ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "private, no-store",
    },
  });
}
