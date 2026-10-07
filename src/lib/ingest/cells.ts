/** Cell-level helpers shared by every parser. */

/** "Amount spent (USD)" -> "amount spent (usd)"; "total_sales" -> "total sales". */
export function norm(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Index of the first header matching any of the names (normalized). */
export function col(headers: string[], ...names: string[]): number {
  const n = headers.map(norm);
  for (const name of names) {
    const i = n.indexOf(norm(name));
    if (i >= 0) return i;
  }
  return -1;
}

/** Like col() but matches headers that start with the given prefix. */
export function colPrefix(headers: string[], ...prefixes: string[]): number {
  const n = headers.map(norm);
  for (const p of prefixes) {
    const i = n.findIndex((h) => h.startsWith(norm(p)));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Find the header row: the first row (within the first 15) where at least
 * `min` cells match the known header names.
 */
export function findHeaderRow(rows: string[][], known: string[], min = 2): number {
  const set = new Set(known.map(norm));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter((c) => set.has(norm(c))).length;
    if (hits >= min) return i;
  }
  return -1;
}

const EMPTY = new Set(["", "-", "--", "n/a", "na", "null", "none", "(not set)"]);

/**
 * "1,234" -> 1234, "$719.19" -> 719.19, "(12)" -> -12, "2.18%" -> 2.18.
 * Returns null for blanks and dashes.
 */
export function num(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim();
  if (EMPTY.has(s.toLowerCase())) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$€£,\s%x]/gi, "");
  if (s === "" || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const v = Number(s);
  return Number.isFinite(v) ? (negative ? -v : v) : null;
}

/** Rates may be "0.987", "98.7" or "98.7%". Always returns a fraction. */
export function rate(raw: string | undefined): number | null {
  const v = num(raw);
  if (v === null) return null;
  return raw?.includes("%") || v > 1 ? v / 100 : v;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, "0");

function iso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Parse the date formats platforms export. `yearHint` is used when the cell
 * has no year (TikTok's "July 1"): the year is chosen so the date is not after
 * the hint date.
 */
export function parseDate(raw: string | undefined, yearHint?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let m: RegExpExecArray | null;

  if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return iso(+m[1], +m[2], +m[3]); // 20260701
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s))) return iso(+m[1], +m[2], +m[3]); // 2026-07-01(T...)
  if ((m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s.*)?$/.exec(s))) return iso(+m[1], +m[2], +m[3]); // 2026/07/01
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s.*)?$/.exec(s))) {
    // US month/day/year, which is what US-locale exports use.
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[1], +m[2]);
  }
  // "Jul 1, 2026", "July 1 2026", "Wed, Jul 1, 2026", "1 Jul 2026", "July 1"
  const words = s.toLowerCase().replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const monthIdx = words.findIndex((w) => MONTHS[w.slice(0, 3)] !== undefined && /^[a-z]+\.?$/.test(w));
  if (monthIdx >= 0) {
    const month = MONTHS[words[monthIdx].slice(0, 3)];
    const nums = words.filter((w) => /^\d+$/.test(w)).map(Number);
    const day = nums.find((n) => n >= 1 && n <= 31);
    const year = nums.find((n) => n >= 1900);
    if (day === undefined) return null;
    if (year) return iso(year, month, day);
    if (!yearHint) return null;
    const hy = Number(yearHint.slice(0, 4));
    const candidate = iso(hy, month, day);
    return candidate && candidate > yearHint ? iso(hy - 1, month, day) : candidate;
  }
  return null;
}

/** Parse "07/03/2026 10:00", "2026-07-03T15:00:00+0000" etc. to an ISO timestamp. */
export function parseTimestamp(raw: string | undefined, yearHint?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const date = parseDate(s, yearHint);
  if (!date) return null;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s.replace(/^\d{4}-\d{2}-\d{2}/, ""));
  if (!t) return `${date}T12:00:00Z`;
  let h = +t[1];
  if (t[4]) h = (h % 12) + (t[4].toLowerCase() === "pm" ? 12 : 0);
  return `${date}T${pad(h)}:${t[2]}:${t[3] ?? "00"}Z`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function monthEnd(date: string): string {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** "2026-07", "Jul 2026", "July 2026" -> first and last day of that month. */
export function parseMonth(raw: string | undefined): { start: string; end: string } | null {
  if (!raw) return null;
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) {
    const start = iso(+m[1], +m[2], 1);
    return start ? { start, end: monthEnd(start) } : null;
  }
  m = /^([a-z]+)\.?\s+(\d{4})$/i.exec(s);
  if (m && MONTHS[m[1].toLowerCase().slice(0, 3)]) {
    const start = iso(+m[2], MONTHS[m[1].toLowerCase().slice(0, 3)], 1);
    return start ? { start, end: monthEnd(start) } : null;
  }
  return null;
}

/** First ~80 characters of a caption, on a word boundary, for table display. */
export function summarize(text: string | null | undefined, max = 80): string | null {
  if (!text) return null;
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max)}...`;
}
