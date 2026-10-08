"use client";

import { createClient } from "@/lib/supabase/client";
import { safeFileName, stagedFolder, type StagedFile } from "./staging";

/**
 * Upload files to Storage from the browser (as the signed-in FFM user;
 * storage policies allow FFM staff only). Returns where each one landed.
 */
export async function stageFiles(clientId: string, batchId: string, files: { id: string; file: File }[]): Promise<Map<string, StagedFile>> {
  const supabase = createClient();
  const folder = stagedFolder(clientId, batchId);
  const out = new Map<string, StagedFile>();
  await Promise.all(
    files.map(async ({ id, file }, i) => {
      const path = `${folder}/${String(i + 1).padStart(2, "0")}-${id.slice(0, 8)}-${safeFileName(file.name)}`;
      const { error } = await supabase.storage.from("uploads").upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        throw new Error(
          /exceeded|too large|size/i.test(error.message)
            ? `${file.name} is larger than the storage limit. Run the bigger-uploads SQL in Supabase, or use a smaller file.`
            : `Could not upload ${file.name}: ${error.message}`,
        );
      }
      out.set(id, { path, name: file.name, type: file.type });
    }),
  );
  return out;
}
