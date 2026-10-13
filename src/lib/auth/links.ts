import "server-only";
import { siteUrl } from "@/lib/data/admin";
import { adminApiConfigured, createAuthAdminClient, createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Someone invited who never clicked their invite is not "signed up" yet, so
 * Supabase refuses a normal sign-in link for them ("Signups not allowed",
 * since self sign-up is off). They get their invite again instead.
 */
async function pendingInvite(email: string): Promise<boolean> {
  if (!adminApiConfigured()) return false;
  const { data: row } = await createServiceClient().from("users").select("id").eq("email", email).maybeSingle();
  if (!row) return false;
  const { data } = await createAuthAdminClient().getUserById(row.id as string);
  return Boolean(data.user && !data.user.email_confirmed_at && !data.user.last_sign_in_at);
}

export async function sendLinkOrInvite(email: string, next: string): Promise<{ reinvited: boolean } | { error: string }> {
  const redirectTo = `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
  if (await pendingInvite(email)) {
    const { error } = await createAuthAdminClient().inviteUserByEmail(email, { redirectTo });
    return error ? { error: error.message } : { reinvited: true };
  }
  const supabase = await createClient();
  // signInWithOtp on the server sends the email without touching the caller's own session.
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
  return error ? { error: error.message } : { reinvited: false };
}

/** Re-send a pending invite, only if this address has one. Says nothing either way. */
export async function resendPendingInvite(email: string, next: string): Promise<void> {
  if (!(await pendingInvite(email))) return;
  const redirectTo = `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
  await createAuthAdminClient().inviteUserByEmail(email, { redirectTo });
}
