/**
 * Files for AI reading go from the browser straight to Supabase Storage
 * ("staged"), then the server hands Claude short-lived signed links. This
 * keeps large batches and big PDFs off the app server, whose requests are
 * capped at about 4.5 MB on Vercel.
 */
export interface StagedFile {
  path: string;
  name: string;
  type: string;
}

export const stagedFolder = (clientId: string, batchId: string) => `${clientId}/staged/${batchId}`;

/** Only this client's staged folder, no traversal. */
export function isStagedPath(clientId: string, path: string): boolean {
  return path.startsWith(`${clientId}/staged/`) && !path.includes("..") && path.split("/").length === 4;
}

export const safeFileName = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-100) || "file";
