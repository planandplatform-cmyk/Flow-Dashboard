/** The numeric GA4 property ID from what was pasted ("412345678", "properties/412345678"). Null if it is not one. */
export function parsePropertyId(raw: string): string | null {
  const v = raw.trim().replace(/^properties\//i, "");
  return /^\d{6,12}$/.test(v) ? v : null;
}
