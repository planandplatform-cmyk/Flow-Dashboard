/**
 * House style for client-facing copy: no em dashes, no en dashes in ranges.
 * Applied to every AI draft before anyone sees it.
 */
export function cleanCopy(text: string): string {
  return text
    .replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2") // 3–5 → 3 to 5
    .replace(/\s*—\s*/g, ", ") // a pause → a comma
    .replace(/\s+–\s+/g, ", ")
    .replace(/–/g, "-")
    .replace(/,\s*,/g, ",")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/** True if the text breaks a copy rule (used to check drafts in tests). */
export function hasDash(text: string): boolean {
  return /[–—]/.test(text);
}
