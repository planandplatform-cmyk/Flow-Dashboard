import "server-only";
import { getClientBySlug, getViewer, isFfm, type Client } from "./portal";

/** FFM staff only. Row-level security enforces the same rule in the database. */
export async function authorizeStaffForClient(slug: string): Promise<{ client: Client } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !isFfm(viewer.role)) return { error: "Only Flow Forward Media staff can manage data." };
  const client = await getClientBySlug(slug);
  if (!client) return { error: "Client not found." };
  return { client };
}

/** Record an FFM action in the append-only audit log (RLS checks actor = signed-in user). */
export async function auditAction(clientId: string | null, action: string, details: Record<string, unknown>) {
  const { createClient } = await import("@/lib/supabase/server");
  const viewer = await getViewer();
  if (!viewer || viewer.demo) return;
  const supabase = await createClient();
  await supabase.from("audit_log").insert({ actor_id: viewer.id, client_id: clientId, action, details });
}
