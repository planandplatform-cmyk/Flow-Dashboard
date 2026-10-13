"use server";

import { resendPendingInvite } from "@/lib/auth/links";
import { isDemoMode } from "@/lib/supabase/env";

/**
 * Called by the login form when Supabase will not send a sign-in link. If the
 * address has an invite that was never accepted, the invite goes out again.
 * Returns nothing, so the form cannot reveal who has been invited.
 */
export async function resendInviteFromLogin(email: string, next: string | undefined): Promise<void> {
  if (isDemoMode()) return;
  const clean = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) return;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  try {
    await resendPendingInvite(clean, safeNext);
  } catch {
    // Same response either way.
  }
}
