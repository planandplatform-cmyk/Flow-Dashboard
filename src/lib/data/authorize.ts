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
