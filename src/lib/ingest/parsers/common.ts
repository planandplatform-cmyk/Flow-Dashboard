import { norm } from "../cells";
import type { ParseContext } from "../types";

/**
 * Resolve a set of named roles to column indices. Each role lists the header
 * names it accepts, in order of preference. Returns the indices plus the
 * headers nobody claimed (minus ones the parser deliberately ignores).
 */
export function mapHeaders<R extends string>(
  headers: string[],
  roles: Record<R, string[]>,
  ignore: string[] = [],
): { idx: Record<R, number>; mapped: string[]; unmapped: string[] } {
  const normalized = headers.map(norm);
  const idx = {} as Record<R, number>;
  const used = new Set<number>();
  for (const role of Object.keys(roles) as R[]) {
    idx[role] = -1;
    for (const name of roles[role]) {
      const i = normalized.indexOf(norm(name));
      if (i >= 0 && !used.has(i)) {
        idx[role] = i;
        used.add(i);
        break;
      }
    }
  }
  const ignored = ignore.map(norm);
  const isIgnored = (h: string) => ignored.some((g) => (g.endsWith("*") ? h.startsWith(g.slice(0, -1)) : h === g));
  return {
    idx,
    mapped: [...used].map((i) => headers[i]),
    unmapped: headers.filter((h, i) => h && !used.has(i) && !isIgnored(normalized[i])),
  };
}

export const cell = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);

/** Header names present in any of the first rows of any sheet, normalized. */
export function headerSet(rows: string[][], depth = 15): Set<string> {
  const out = new Set<string>();
  for (const r of rows.slice(0, depth)) for (const c of r) if (c) out.add(norm(c));
  return out;
}

export function hasAll(set: Set<string>, ...names: string[]) {
  return names.every((n) => set.has(norm(n)));
}

export function hasAny(set: Set<string>, ...names: string[]) {
  return names.some((n) => set.has(norm(n)));
}

export function missingPeriodMessage(what: string) {
  return `This ${what} file has no dates in it. Enter the period it covers (start and end date) and preview again.`;
}

export function yearHint(ctx: ParseContext): string {
  return ctx.period?.end ?? ctx.today;
}
