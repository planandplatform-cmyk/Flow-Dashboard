import "server-only";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { DataSource } from "@/lib/metrics/types";

export interface UploadLogEntry {
  id: string;
  created_at: string;
  source: DataSource;
  kind: "file" | "manual";
  file_name: string | null;
  parser: string | null;
  period_start: string | null;
  period_end: string | null;
  rows_inserted: number;
  rows_updated: number;
  status: "pending" | "running" | "succeeded" | "failed" | "rolled_back";
  error: string | null;
  rolled_back_at: string | null;
  uploader: { email: string } | null;
  rolled_back_by_user: { email: string } | null;
}

export interface OverlapCounts {
  incoming: number;
  existing: number;
  changed: number;
}
export type UploadOverlap = Record<"daily" | "period" | "posts" | "snapshots" | "adDaily", OverlapCounts>;

export async function listUploads(clientId: string, limit = 50): Promise<UploadLogEntry[]> {
  if (isDemoMode()) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("uploads")
    .select(
      "id, created_at, source, kind, file_name, parser, period_start, period_end, rows_inserted, rows_updated, status, error, rolled_back_at, uploader:users!uploads_uploaded_by_fkey(email), rolled_back_by_user:users!uploads_rolled_back_by_fkey(email)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as UploadLogEntry[];
}
