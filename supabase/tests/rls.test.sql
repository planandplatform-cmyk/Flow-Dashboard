-- Row-level security test.
--
-- Proves a client user can only ever read their own client's rows, never sees
-- drafts or FFM-only tables, and cannot write anything. Also checks staff and
-- admin boundaries.
--
-- Safe to run against a real Supabase database (paste into the SQL Editor, or
-- psql as the postgres user): everything happens in one transaction that is rolled back.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql
--
-- Any failure raises an exception naming the broken rule.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as the database owner)
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000a1', 'viewer-a@rls.test'),
  ('00000000-0000-4000-a000-0000000000b1', 'viewer-b@rls.test'),
  ('00000000-0000-4000-a000-0000000000c1', 'staff@rls.test'),
  ('00000000-0000-4000-a000-0000000000d1', 'admin@rls.test'),
  ('00000000-0000-4000-a000-0000000000e1', 'unlinked@rls.test');

-- The signup trigger must have created client_viewer profiles.
do $$
begin
  if (select count(*) from public.users where email like '%@rls.test' and role = 'client_viewer') <> 5 then
    raise exception 'FAIL: signup trigger did not create client_viewer profiles';
  end if;
end $$;

update public.users set role = 'ffm_staff' where id = '00000000-0000-4000-a000-0000000000c1';
update public.users set role = 'ffm_admin' where id = '00000000-0000-4000-a000-0000000000d1';

insert into public.clients (id, name, slug, enabled_sources) values
  ('00000000-0000-4000-b000-00000000000a', 'RLS Client A', 'rls-client-a', '{ga4}'),
  ('00000000-0000-4000-b000-00000000000b', 'RLS Client B', 'rls-client-b', '{ga4}');

insert into public.user_clients (user_id, client_id) values
  ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-b000-00000000000a'),
  ('00000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-b000-00000000000b');

insert into public.metrics_daily (client_id, source, metric_key, date, value) values
  ('00000000-0000-4000-b000-00000000000a', 'ga4', 'ga4_sessions', '2026-07-01', 10),
  ('00000000-0000-4000-b000-00000000000b', 'ga4', 'ga4_sessions', '2026-07-01', 20);
insert into public.metrics_period (client_id, source, metric_key, period_start, period_end, value) values
  ('00000000-0000-4000-b000-00000000000a', 'meta_ads', 'ads_reach', '2026-07-01', '2026-07-31', 1),
  ('00000000-0000-4000-b000-00000000000b', 'meta_ads', 'ads_reach', '2026-07-01', '2026-07-31', 2);
insert into public.posts (client_id, platform, external_id, published_at) values
  ('00000000-0000-4000-b000-00000000000a', 'meta_instagram', 'rls-a', now()),
  ('00000000-0000-4000-b000-00000000000b', 'meta_instagram', 'rls-b', now());
insert into public.audience_snapshots (client_id, platform, snapshot_date, breakdown_type, bucket, share) values
  ('00000000-0000-4000-b000-00000000000a', 'meta_instagram', '2026-07-31', 'age', '25-34', 0.5),
  ('00000000-0000-4000-b000-00000000000b', 'meta_instagram', '2026-07-31', 'age', '25-34', 0.5);
insert into public.ad_campaigns (id, client_id, external_campaign_id, name) values
  ('00000000-0000-4000-c000-00000000000a', '00000000-0000-4000-b000-00000000000a', 'rls-a', 'A'),
  ('00000000-0000-4000-c000-00000000000b', '00000000-0000-4000-b000-00000000000b', 'rls-b', 'B');
insert into public.ad_metrics_daily (client_id, campaign_id, date, spend) values
  ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-c000-00000000000a', '2026-07-01', 1),
  ('00000000-0000-4000-b000-00000000000b', '00000000-0000-4000-c000-00000000000b', '2026-07-01', 2);
insert into public.annotations (client_id, date, label) values
  ('00000000-0000-4000-b000-00000000000a', '2026-07-14', 'A event'),
  ('00000000-0000-4000-b000-00000000000b', '2026-07-14', 'B event');
insert into public.monthly_commentary (client_id, month, headline, status) values
  ('00000000-0000-4000-b000-00000000000a', '2026-07-01', 'A published', 'published'),
  ('00000000-0000-4000-b000-00000000000a', '2026-06-01', 'A draft', 'draft'),
  ('00000000-0000-4000-b000-00000000000b', '2026-07-01', 'B published', 'published');
insert into public.connections (client_id, source, credentials_secret_id) values
  ('00000000-0000-4000-b000-00000000000a', 'ga4', gen_random_uuid()),
  ('00000000-0000-4000-b000-00000000000b', 'ga4', gen_random_uuid());
insert into public.uploads (client_id, source, file_name) values
  ('00000000-0000-4000-b000-00000000000a', 'ga4', 'a.csv');
insert into public.sync_runs (client_id, source, period_start, period_end) values
  ('00000000-0000-4000-b000-00000000000a', 'ga4', '2026-07-01', '2026-07-31');
insert into public.audit_log (client_id, action) values
  ('00000000-0000-4000-b000-00000000000a', 'rls.test');

-- ---------------------------------------------------------------------------
-- Client viewer A
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000a1","role":"authenticated"}', true);

do $$
declare
  t text;
  n_own bigint;
  n_other bigint;
begin
  -- Exactly their own client.
  if (select count(*) from public.clients) <> 1
     or not exists (select 1 from public.clients where id = '00000000-0000-4000-b000-00000000000a') then
    raise exception 'FAIL: viewer A must see exactly client A';
  end if;

  -- No rows from client B in any data table, and their own rows are visible.
  foreach t in array array[
    'metrics_daily', 'metrics_period', 'posts', 'audience_snapshots',
    'ad_campaigns', 'ad_metrics_daily', 'annotations'
  ] loop
    execute format('select count(*) from public.%I where client_id = %L', t, '00000000-0000-4000-b000-00000000000b') into n_other;
    execute format('select count(*) from public.%I where client_id = %L', t, '00000000-0000-4000-b000-00000000000a') into n_own;
    if n_other <> 0 then
      raise exception 'FAIL: viewer A can read % rows of client B in %', n_other, t;
    end if;
    if n_own = 0 then
      raise exception 'FAIL: viewer A cannot read own rows in %', t;
    end if;
  end loop;

  -- Only published commentary, only their own.
  if (select count(*) from public.monthly_commentary) <> 1
     or (select headline from public.monthly_commentary) <> 'A published' then
    raise exception 'FAIL: viewer A must see only their own published commentary';
  end if;

  -- FFM-only tables are invisible.
  foreach t in array array['uploads', 'sync_runs', 'audit_log'] loop
    execute format('select count(*) from public.%I', t) into n_other;
    if n_other <> 0 then
      raise exception 'FAIL: viewer A can read % rows of %', n_other, t;
    end if;
  end loop;
  if (select count(*) from public.connections) <> 0 then
    raise exception 'FAIL: viewer A can read connections';
  end if;

  -- Only their own profile and memberships.
  if (select count(*) from public.users) <> 1 then
    raise exception 'FAIL: viewer A can read other users';
  end if;
  if (select count(*) from public.user_clients) <> 1 then
    raise exception 'FAIL: viewer A can read other memberships';
  end if;
end $$;

-- Writes are all rejected.
do $$
begin
  begin
    insert into public.metrics_daily (client_id, source, metric_key, date, value)
    values ('00000000-0000-4000-b000-00000000000a', 'ga4', 'ga4_sessions', '2026-07-02', 999);
    raise exception 'FAIL: viewer A inserted metrics';
  exception when insufficient_privilege then null;
  end;

  update public.users set role = 'ffm_admin' where id = '00000000-0000-4000-a000-0000000000a1';
  if (select role from public.users where id = '00000000-0000-4000-a000-0000000000a1') <> 'client_viewer' then
    raise exception 'FAIL: viewer A escalated their own role';
  end if;

  begin
    insert into public.user_clients (user_id, client_id)
    values ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-b000-00000000000b');
    raise exception 'FAIL: viewer A linked themselves to client B';
  exception when insufficient_privilege then null;
  end;

  update public.metrics_daily set value = 0 where client_id = '00000000-0000-4000-b000-00000000000b';
  delete from public.metrics_daily where client_id = '00000000-0000-4000-b000-00000000000a';
  update public.monthly_commentary set status = 'published' where headline = 'A draft';
end $$;

reset role;

do $$
begin
  if (select sum(value) from public.metrics_daily where client_id in
        ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-b000-00000000000b')) <> 30 then
    raise exception 'FAIL: viewer A modified metrics_daily';
  end if;
  if (select status from public.monthly_commentary where headline = 'A draft') <> 'draft' then
    raise exception 'FAIL: viewer A published a draft';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- A viewer linked to two clients sees both; archiving one hides it
-- ---------------------------------------------------------------------------

insert into public.user_clients (user_id, client_id)
values ('00000000-0000-4000-a000-0000000000b1', '00000000-0000-4000-b000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.clients where name like 'RLS Client %') <> 2 then
    raise exception 'FAIL: a viewer linked to two clients must see both';
  end if;
end $$;
reset role;

update public.clients set archived_at = now() where id = '00000000-0000-4000-b000-00000000000a';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000b1","role":"authenticated"}', true);
do $$
begin
  if exists (select 1 from public.clients where id = '00000000-0000-4000-b000-00000000000a')
     or exists (select 1 from public.metrics_daily where client_id = '00000000-0000-4000-b000-00000000000a') then
    raise exception 'FAIL: an archived client is still visible to its logins';
  end if;
  if not exists (select 1 from public.clients where id = '00000000-0000-4000-b000-00000000000b') then
    raise exception 'FAIL: archiving one client hid another';
  end if;
end $$;
reset role;

update public.clients set archived_at = null where id = '00000000-0000-4000-b000-00000000000a';
delete from public.user_clients
 where user_id = '00000000-0000-4000-a000-0000000000b1' and client_id = '00000000-0000-4000-b000-00000000000a';

-- ---------------------------------------------------------------------------
-- Unlinked user and anonymous visitors see nothing
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000e1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.clients) <> 0 or (select count(*) from public.metrics_daily) <> 0 then
    raise exception 'FAIL: unlinked user can read client data';
  end if;
end $$;
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  begin
    perform 1 from public.metrics_daily limit 1;
    raise exception 'FAIL: anon can query metrics_daily';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- FFM staff: read everything, write data, cannot manage clients or users
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000c1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.clients where name like 'RLS Client %') <> 2 then
    raise exception 'FAIL: staff must see all clients';
  end if;
  if (select count(*) from public.monthly_commentary where headline = 'A draft') <> 1 then
    raise exception 'FAIL: staff must see drafts';
  end if;

  insert into public.metrics_daily (client_id, source, metric_key, date, value)
  values ('00000000-0000-4000-b000-00000000000b', 'ga4', 'ga4_sessions', '2026-07-03', 5);

  begin
    insert into public.clients (name, slug) values ('Nope', 'nope');
    raise exception 'FAIL: staff created a client';
  exception when insufficient_privilege then null;
  end;

  update public.users set role = 'ffm_admin' where id = '00000000-0000-4000-a000-0000000000c1';
  if (select role from public.users where id = '00000000-0000-4000-a000-0000000000c1') <> 'ffm_staff' then
    raise exception 'FAIL: staff escalated their own role';
  end if;

  begin
    insert into public.user_clients (user_id, client_id)
    values ('00000000-0000-4000-a000-0000000000e1', '00000000-0000-4000-b000-00000000000a');
    raise exception 'FAIL: staff gave a login access to a client';
  exception when insufficient_privilege then null;
  end;

  update public.clients set enabled_sources = '{tiktok}' where id = '00000000-0000-4000-b000-00000000000a';
  if (select enabled_sources from public.clients where id = '00000000-0000-4000-b000-00000000000a') <> '{ga4}' then
    raise exception 'FAIL: staff changed a client''s channels';
  end if;
end $$;
reset role;

-- ---------------------------------------------------------------------------
-- Credentials are never readable through the API, even by admins
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000d1","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.connections where client_id in
        ('00000000-0000-4000-b000-00000000000a', '00000000-0000-4000-b000-00000000000b')) <> 2 then
    raise exception 'FAIL: admin must see connections';
  end if;
  begin
    perform credentials_secret_id from public.connections limit 1;
    raise exception 'FAIL: admin can read credentials_secret_id';
  exception when insufficient_privilege then null;
  end;

  insert into public.clients (name, slug) values ('Admin Made', 'rls-admin-made');
  insert into public.user_clients (user_id, client_id)
  values ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-b000-00000000000b');
end $$;
reset role;

rollback;

-- Only reached if every check above passed (any failure stops with an error).
select 'RLS tests passed' as result;
