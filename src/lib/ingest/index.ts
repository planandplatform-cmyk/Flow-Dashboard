/**
 * File ingestion entry point: read the file, pick the parser that best
 * recognizes it, and return normalized rows plus everything the preview
 * screen needs. Pure; no database access.
 */
import { SOURCE_LABELS } from "@/lib/metrics/types";
import { BatchBuilder } from "./batch";
import { ga4Parser } from "./parsers/ga4";
import { googleAdsParser } from "./parsers/google-ads";
import { linkedinParser } from "./parsers/linkedin";
import { metaAdsParser } from "./parsers/meta-ads";
import { metaContentParser, metaInsightsParser } from "./parsers/meta-organic";
import { shopifyParser } from "./parsers/shopify";
import { tiktokParser } from "./parsers/tiktok";
import { MAX_UPLOAD_BYTES, readTable } from "./table";
import type { ParseContext, ParseResult, Parser } from "./types";

export const PARSERS: Parser[] = [
  ga4Parser,
  metaContentParser,
  metaInsightsParser,
  metaAdsParser,
  googleAdsParser,
  shopifyParser,
  tiktokParser,
  linkedinParser,
];

const ACCEPTED = /\.(csv|tsv|txt|xlsx|xls|xlsm)$/i;

function failure(message: string, parser = { id: "none", label: "Not recognized" }): ParseResult {
  const b = new BatchBuilder();
  b.error(message);
  return b.finalize(parser);
}

export function parseUpload(data: ArrayBuffer | Uint8Array, ctx: ParseContext): ParseResult {
  const size = data.byteLength;
  if (size === 0) return failure("The file is empty.");
  if (size > MAX_UPLOAD_BYTES) return failure("The file is larger than 4 MB. Export a shorter date range and try again.");
  if (/\.pdf$/i.test(ctx.fileName)) return failure("PDFs are read on the Screenshots & PDFs tab, where AI reads the numbers and you check them.");
  if (!ACCEPTED.test(ctx.fileName)) return failure("Upload a CSV or Excel file (.csv, .xlsx, .xls).");

  let sheets;
  try {
    sheets = readTable(data, ctx.fileName);
  } catch {
    return failure("The file could not be opened. Re-export it from the platform as CSV or Excel and try again.");
  }

  const scored = PARSERS.map((p) => ({ p, score: p.detect(sheets, ctx) })).sort((a, b) => b.score - a.score);
  const forSource = ctx.source ? scored.filter((s) => s.p.sources.includes(ctx.source!)) : scored;
  let chosen = forSource[0]?.score >= 0.3 ? forSource[0] : undefined;
  const builder = new BatchBuilder();

  if (!chosen) {
    const best = scored[0];
    if (!best || best.score < 0.3) {
      return failure(
        ctx.source
          ? `This does not look like a ${SOURCE_LABELS[ctx.source]} export we recognize. Check that it is the original file downloaded from the platform.`
          : "We could not recognize this file. Choose the platform it came from and try again.",
      );
    }
    chosen = best;
    if (ctx.source) {
      builder.warn(
        `You chose ${SOURCE_LABELS[ctx.source]}, but this looks like a ${chosen.p.label}. It was read as that instead.`,
      );
    }
  }

  try {
    chosen.p.parse(sheets, ctx, builder);
  } catch (e) {
    builder.error(`The file could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
  return builder.finalize(chosen.p);
}

export type { ParseResult, ParseContext, IngestBatch } from "./types";
