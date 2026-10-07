-- Row-level security.
--
-- Rules:
--   ffm_admin     full access to everything.
--   ffm_staff     read everything; write client data, uploads, commentary,
--                 annotations. Cannot manage clients, users, or connections.
--   client_viewer read-only, and only for clients linked in user_clients.
--                 Commentary is visible only once published. Connections,
--                 uploads, sync runs and the audit log are never visible.
--   anon          nothing.
--
-- Helpers live in a non-exposed schema so they are not callable over the API.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.current_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.users where id = (select auth.uid());
$$;

create or replace function private.is_ffm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() in ('ffm_admin', 'ffm_staff'), false);
$$;

create or replace function private.is_ffm_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() = 'ffm_admin', false);
$$;

create or replace function private.can_view_client(target_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_ffm()
      or exists (
           select 1
           from public.user_clients uc
           where uc.user_id = (select auth.uid())
             and uc.client_id = target_client_id
         );
$$;

revoke all on function private.current_role(), private.is_ffm(), private.is_ffm_admin(),
  private.can_view_client(uuid) from public;
grant execute on function private.current_role(), private.is_ffm(), private.is_ffm_admin(),
  private.can_view_client(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'users', 'user_clients', 'connections', 'uploads', 'sync_runs', 'audit_log',
    'metrics_daily', 'metrics_period', 'posts', 'audience_snapshots', 'ad_campaigns',
    'ad_metrics_daily', 'monthly_commentary', 'annotations'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end;
$$;

-- Nothing is ever exposed to signed-out visitors.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Clients, users, memberships
-- ---------------------------------------------------------------------------

create policy clients_select on public.clients
  for select to authenticated
  using (private.can_view_client(id));

create policy clients_admin_write on public.clients
  for all to authenticated
  using (private.is_ffm_admin())
  with check (private.is_ffm_admin());

create policy users_select on public.users
  for select to authenticated
  using (id = (select auth.uid()) or private.is_ffm());

create policy users_admin_write on public.users
  for all to authenticated
  using (private.is_ffm_admin())
  with check (private.is_ffm_admin());

create policy user_clients_select on public.user_clients
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_ffm());

create policy user_clients_admin_write on public.user_clients
  for all to authenticated
  using (private.is_ffm_admin())
  with check (private.is_ffm_admin());

-- ---------------------------------------------------------------------------
-- FFM-only operational tables
-- ---------------------------------------------------------------------------

create policy connections_ffm_select on public.connections
  for select to authenticated
  using (private.is_ffm());

create policy connections_admin_write on public.connections
  for all to authenticated
  using (private.is_ffm_admin())
  with check (private.is_ffm_admin());

-- Even admins never touch credentials through the browser API: the vault
-- secret id column is excluded from the authenticated role's grants, and is
-- only written server-side with the service role. (A column-level revoke does
-- not override a table-level grant, so grants are rebuilt as an allowlist.)
revoke all on public.connections from authenticated;
grant select (id, client_id, source, external_account_id, external_account_name, status,
              token_expires_at, last_synced_at, last_error, last_error_at, created_at, updated_at)
  on public.connections to authenticated;
grant insert (client_id, source, external_account_id, external_account_name, status)
  on public.connections to authenticated;
grant update (external_account_id, external_account_name, status)
  on public.connections to authenticated;
grant delete on public.connections to authenticated;

do $$
declare t text;
begin
  foreach t in array array['uploads', 'sync_runs'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.is_ffm())',
      t || '_ffm_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (private.is_ffm())',
      t || '_ffm_insert', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (private.is_ffm()) with check (private.is_ffm())',
      t || '_ffm_update', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (private.is_ffm_admin())',
      t || '_admin_delete', t);
  end loop;
end;
$$;

-- Append-only: insert as yourself, never update or delete.
create policy audit_log_ffm_select on public.audit_log
  for select to authenticated
  using (private.is_ffm());

create policy audit_log_ffm_insert on public.audit_log
  for insert to authenticated
  with check (private.is_ffm() and actor_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Client data: viewers read their own clients, FFM writes
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'metrics_daily', 'metrics_period', 'posts', 'audience_snapshots',
    'ad_campaigns', 'ad_metrics_daily', 'annotations'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.can_view_client(client_id))',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (private.is_ffm()) with check (private.is_ffm())',
      t || '_ffm_write', t);
  end loop;
end;
$$;

-- Clients only ever see published commentary.
create policy monthly_commentary_select on public.monthly_commentary
  for select to authenticated
  using (
    private.is_ffm()
    or (status = 'published' and private.can_view_client(client_id))
  );

create policy monthly_commentary_ffm_write on public.monthly_commentary
  for all to authenticated
  using (private.is_ffm())
  with check (private.is_ffm());
