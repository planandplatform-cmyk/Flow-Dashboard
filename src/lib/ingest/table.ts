import * as XLSX from "xlsx";
import type { Sheet } from "./types";

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel caps request bodies at 4.5 MB

/** Read a CSV, TSV, XLSX or XLS file into sheets of trimmed strings. */
export function readTable(data: ArrayBuffer | Uint8Array, fileName: string): Sheet[] {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls") || lower.endsWith(".xlsm") || looksLikeZipOrOle(bytes)) {
    return readWorkbook(bytes);
  }
  return [{ name: fileName, rows: parseCsv(decodeText(bytes)) }];
}

function looksLikeZipOrOle(b: Uint8Array): boolean {
  const zip = b[0] === 0x50 && b[1] === 0x4b; // PK
  const ole = b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
  return zip || ole;
}

function readWorkbook(bytes: Uint8Array): Sheet[] {
  // dense + no formulas: we only want displayed values. Dates are formatted as
  // ISO strings so the date parser sees one consistent shape.
  const wb = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: false, cellHTML: false, dense: true });
  return wb.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
      header: 1,
      raw: false,
      dateNF: "yyyy-mm-dd",
      defval: "",
      blankrows: true,
    });
    return { name, rows: rows.map((r) => r.map((c) => String(c ?? "").trim())) };
  });
}

function decodeText(bytes: Uint8Array): string {
  // UTF-16 exports (some Excel "Unicode text" saves) start with a BOM.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/**
 * RFC 4180 CSV parser. Handles quoted fields with commas and newlines, the
 * Excel "sep=," hint line, and comma, semicolon or tab delimiters.
 */
export function parseCsv(text: string): string[][] {
  let body = text;
  let delimiter: string | null = null;
  const sep = /^"?sep=(.)"?\r?\n/i.exec(body);
  if (sep) {
    delimiter = sep[1];
    body = body.slice(sep[0].length);
  }
  delimiter ??= sniffDelimiter(body);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inQuotes) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows;
}

function sniffDelimiter(text: string): string {
  const sample = text
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("#"))
    .slice(0, 10);
  const counts = [",", ";", "\t"].map((d) => ({ d, n: sample.reduce((s, l) => s + l.split(d).length - 1, 0) }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function isBlankRow(row: string[] | undefined): boolean {
  return !row || row.every((c) => c === "");
}

/**
 * Split a sheet into blocks separated by blank rows. Lines starting with "#"
 * (GA4 metadata) are collected separately and never part of a block.
 */
export function splitBlocks(rows: string[][]): { comments: string[]; blocks: string[][][] } {
  const comments: string[] = [];
  const blocks: string[][][] = [];
  let current: string[][] = [];
  for (const row of rows) {
    if (row[0]?.startsWith("#")) {
      comments.push(row.join(",").replace(/^#\s?/, ""));
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    if (isBlankRow(row)) {
      if (current.length) blocks.push(current);
      current = [];
      continue;
    }
    current.push(row);
  }
  if (current.length) blocks.push(current);
  return { comments, blocks };
}
