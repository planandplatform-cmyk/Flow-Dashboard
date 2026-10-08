import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/supabase/env";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOTS, MAX_SCREENSHOTS_TOTAL_BYTES, SCREENSHOT_TYPES } from "./screenshot";
import type { ScreenshotImage } from "./screenshot-reader";
import { isStagedPath, type StagedFile } from "./staging";

export interface ResolvedFiles {
  images: ScreenshotImage[];
  names: string[];
  /** Storage folder holding the files (staged uploads), or null in demo mode. */
  folder: string | null;
  /** Demo mode only: the files themselves, sent through the server. */
  files: File[];
}

const typeOk = (t: string) => (SCREENSHOT_TYPES as readonly string[]).includes(t);

/**
 * The files for an AI read or a save: staged Storage paths (normal), or files
 * in the form (demo mode, small batches only).
 */
export async function resolveFiles(form: FormData, clientId: string, max = MAX_SCREENSHOTS): Promise<ResolvedFiles | { error: string }> {
  const raw = form.get("staged");
  if (raw) {
    let staged: StagedFile[];
    try {
      staged = JSON.parse(String(raw)) as StagedFile[];
    } catch {
      return { error: "The uploaded files could not be found. Add them again." };
    }
    if (!Array.isArray(staged) || !staged.length) return { error: "Add at least one screenshot or PDF." };
    if (staged.length > max) return { error: `Upload up to ${max} files at a time.` };
    for (const f of staged) {
      if (!isStagedPath(clientId, String(f.path))) return { error: "One of the files is not in this client's upload folder." };
      if (!typeOk(String(f.type))) return { error: `${f.name} is not a PDF or a PNG, JPEG, WebP or GIF image.` };
    }
    const folders = new Set(staged.map((f) => f.path.split("/").slice(0, 3).join("/")));
    const supabase = await createClient();
    const { data, error } = await supabase.storage.from("uploads").createSignedUrls(
      staged.map((f) => f.path),
      60 * 60,
    );
    if (error || !data) return { error: `Could not open the uploaded files: ${error?.message ?? "unknown error"}` };
    const missing = data.filter((d) => !d.signedUrl);
    if (missing.length) return { error: "Some uploaded files are missing. Add them again." };
    return {
      images: data.map((d, i) => ({ url: d.signedUrl!, mediaType: staged[i].type as ScreenshotImage["mediaType"] })),
      names: staged.map((f) => f.name),
      folder: folders.size === 1 ? [...folders][0] : null,
      files: [],
    };
  }

  // Demo mode: files come in the request itself.
  if (!isDemoMode()) return { error: "Add at least one screenshot or PDF." };
  const files = form.getAll("images").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { error: "Add at least one screenshot or PDF." };
  if (files.length > 5) return { error: "Demo mode reads up to 5 files at a time." };
  let total = 0;
  const images: ScreenshotImage[] = [];
  for (const f of files) {
    if (!typeOk(f.type)) return { error: `${f.name} is not a PDF or a PNG, JPEG, WebP or GIF image.` };
    if (f.size > MAX_SCREENSHOT_BYTES) return { error: `${f.name} is too large for demo mode (3.5 MB).` };
    total += f.size;
    images.push({ data: Buffer.from(await f.arrayBuffer()).toString("base64"), mediaType: f.type as ScreenshotImage["mediaType"] });
  }
  if (total > MAX_SCREENSHOTS_TOTAL_BYTES) return { error: "These files are too large together for demo mode (4 MB)." };
  return { images, names: files.map((f) => f.name), folder: null, files };
}
