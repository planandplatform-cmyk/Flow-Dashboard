"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeEmail, parseClientForm, type FieldErrors } from "@/lib/clients/form";
import { getAdminViewer, getClientSettings, siteUrl } from "@/lib/data/admin";
import type { UserRole } from "@/lib/data/portal";
import { adminApiConfigured, createAuthAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/*
 * Client and user management. Admins only: checked here, and again by
 * row-level security on every write (clients, users and user_clients are
 * admin-write tables). The secret-key auth client is only used after the
 * admin check, and only for sending invites.
 */

export type FormState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: FieldErrors }
  | { status: "done"; message: string };

const DEMO: FormState = { status: "error", message: "Demo mode: connect Supabase to save changes." };
const NOT_ADMIN: FormState = { status: "error", message: "Only Flow Forward Media admins can do this." };

async function audit(clientId: string | null, action: string, details: Record<string, unknown>) {
  const supabase = await createClient();
  const viewer = await getAdminViewer();
  await supabase.from("audit_log").insert({ actor_id: viewer?.id, client_id: clientId, action, details });
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export async function createClientAccount(_prev: FormState, form: FormData): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const { values, errors } = parseClientForm(form);
  if (Object.keys(errors).length) return { status: "error", message: "Check the highlighted fields.", fields: errors };

  const supabase = await createClient();
  const { data, error } = await supabase.from("clients").insert(values).select("id, slug").single();
  if (error) {
    if (error.code === "23505") {
      return { status: "error", message: "That web address is taken.", fields: { slug: "Another client already uses this. Pick a different one." } };
    }
    return { status: "error", message: `Could not create the client. ${error.message}` };
  }
  await audit(data.id, "client.create", { name: values.name, enabled_sources: values.enabled_sources });
  redirect(`/admin/c/${data.slug}/settings?created=1`);
}

export async function updateClientAccount(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  // The web address stays fixed so saved links keep working.
  form.set("slug", client.slug);
  const { values, errors } = parseClientForm(form);
  if (Object.keys(errors).length) return { status: "error", message: "Check the highlighted fields.", fields: errors };

  const supabase = await createClient();
  const { slug: _unchanged, ...changes } = values;
  void _unchanged;
  const { error } = await supabase.from("clients").update(changes).eq("id", client.id);
  if (error) return { status: "error", message: `Could not save. ${error.message}` };

  const turnedOn = values.enabled_sources.filter((s) => !client.enabled_sources.includes(s));
  const turnedOff = client.enabled_sources.filter((s) => !(values.enabled_sources as string[]).includes(s));
  await audit(client.id, "client.update", { turned_on: turnedOn, turned_off: turnedOff });
  refresh();
  return { status: "done", message: "Saved." };
}

export async function setClientArchived(slug: string, archived: boolean): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("clients").update({ archived_at: archived ? new Date().toISOString() : null }).eq("id", client.id);
  if (error) return { status: "error", message: error.message };
  await audit(client.id, archived ? "client.archive" : "client.unarchive", {});
  refresh();
  return { status: "done", message: archived ? "Archived. The client no longer appears in lists, and its logins see nothing." : "Restored." };
}

// ---------------------------------------------------------------------------
// Logins
// ---------------------------------------------------------------------------

/**
 * Find a login by email, or invite a new one. New users start as client
 * viewers with no access; the caller decides what they get.
 */
async function findOrInvite(email: string, next: string): Promise<{ id: string; role: UserRole; invited: boolean } | { error: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("users").select("id, role").eq("email", email).maybeSingle();
  if (existing) return { id: existing.id, role: existing.role as UserRole, invited: false };

  if (!adminApiConfigured()) return { error: "Sending invites needs SUPABASE_SECRET_KEY in the environment variables." };
  const redirectTo = `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
  const { data, error } = await createAuthAdminClient().inviteUserByEmail(email, { redirectTo });
  if (error || !data.user) return { error: `The invite could not be sent. ${error?.message ?? ""}`.trim() };
  return { id: data.user.id, role: "client_viewer", invited: true };
}

export async function inviteClientUser(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const email = normalizeEmail(form.get("email"));
  if (!email) return { status: "error", message: "Enter a valid email address.", fields: {} };
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };

  const user = await findOrInvite(email, `/c/${client.slug}`);
  if ("error" in user) return { status: "error", message: user.error };
  if (user.role !== "client_viewer") {
    return { status: "error", message: `${email} is on the Flow Forward Media team and already sees every client.` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_clients").upsert({ user_id: user.id, client_id: client.id }, { ignoreDuplicates: true });
  if (error) return { status: "error", message: `Could not give access. ${error.message}` };
  await audit(client.id, "client.user_added", { email, invited: user.invited });
  refresh();
  return {
    status: "done",
    message: user.invited
      ? `Invite sent to ${email}. They can sign in from the link in the email.`
      : `${email} already had a login and can now see ${client.name} too.`,
  };
}

export async function removeClientUser(slug: string, userId: string): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const client = await getClientSettings(slug);
  if (!client) return { status: "error", message: "Client not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("user_clients").delete().eq("user_id", userId).eq("client_id", client.id).select("user_id");
  if (error) return { status: "error", message: error.message };
  if (!data?.length) return { status: "error", message: "That person did not have access." };
  await audit(client.id, "client.user_removed", { user_id: userId });
  refresh();
  return { status: "done", message: "Access removed. Their login stays, but they no longer see this client." };
}

/** Email a fresh sign-in link to someone who lost or never used their invite. */
export async function sendSignInLink(next: string, email: string): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  if (!(await getAdminViewer())) return NOT_ADMIN;
  const clean = normalizeEmail(email);
  if (!clean) return { status: "error", message: "Invalid email." };
  const supabase = await createClient();
  // signInWithOtp on the server sends the email without touching the admin's own session.
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteUrl()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { status: "error", message: `Could not send the link. ${error.message}` };
  return { status: "done", message: `Sign-in link sent to ${clean}.` };
}

// ---------------------------------------------------------------------------
// FFM team
// ---------------------------------------------------------------------------

const TEAM_ROLES: UserRole[] = ["ffm_admin", "ffm_staff"];

export async function inviteTeamMember(_prev: FormState, form: FormData): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  const viewer = await getAdminViewer();
  if (!viewer) return NOT_ADMIN;
  const email = normalizeEmail(form.get("email"));
  const role = String(form.get("role")) as UserRole;
  if (!email) return { status: "error", message: "Enter a valid email address." };
  if (!TEAM_ROLES.includes(role)) return { status: "error", message: "Choose Admin or Staff." };

  const user = await findOrInvite(email, "/");
  if ("error" in user) return { status: "error", message: user.error };
  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ role }).eq("id", user.id);
  if (error) return { status: "error", message: error.message };
  await audit(null, "team.member_set", { email, role, invited: user.invited });
  refresh();
  return { status: "done", message: user.invited ? `Invite sent to ${email}.` : `${email} is now ${role === "ffm_admin" ? "an admin" : "staff"}.` };
}

export async function changeTeamRole(userId: string, role: string): Promise<FormState> {
  if (isDemoMode()) return DEMO;
  const viewer = await getAdminViewer();
  if (!viewer) return NOT_ADMIN;
  if (userId === viewer.id) return { status: "error", message: "You cannot change your own role. Ask another admin." };
  if (![...TEAM_ROLES, "client_viewer"].includes(role as UserRole)) return { status: "error", message: "Unknown role." };
  const supabase = await createClient();
  const { error } = await supabase.from("users").update({ role }).eq("id", userId);
  if (error) return { status: "error", message: error.message };
  await audit(null, "team.role_changed", { user_id: userId, role });
  refresh();
  return { status: "done", message: role === "client_viewer" ? "Removed from the team." : "Role updated." };
}
