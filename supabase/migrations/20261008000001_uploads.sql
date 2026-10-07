-- Phase 2: manual uploads.
--
-- commit_upload() writes a whole parsed file in one transaction. Before any
-- existing row is overwritten, its previous version is saved to
-- upload_revisions, so rollback_upload() can put things back exactly as they
-- were. All functions run as the calling user (security invoker), so
-- row-level security still decides who may do what.

alter type public.breakdown_type add value if not exists 'job_function';
alter type public.breakdown_type add value if not exists 'seniority';
alter type public.breakdown_type add value if not exists 'industry';
alter type public.breakdown_type add value if not exists 'company_size';

alter table public.uploads
  add column kind text not null default 'file' check (kind in ('file', 'manual')),
  add column summary jsonb not null default '{}';

alter table public.ad_campaigns
  add column created_by_upload_id uuid references public.uploads (id) on delete set null;

create table public.upload_revisions (
  id         bigint generated always as identity primary key,
  upload_id  uuid not null references public.uploads (id) on delete cascade,
  table_name text not null,
  previous   jsonb not null,
  created_at timestamptz not null default now()
);
create index upload_revisions_upload_idx on public.upload_revisions (upload_id, table_name);

alter table public.upload_revisions enable row level security;
alter table public.upload_revisions force row level security;
revoke all on public.upload_revisions from anon;

create policy upload_revisions_ffm_select on public.upload_revisions
  for select to authenticated using (private.is_ffm());
create policy upload_revisions_ffm_insert on public.upload_revisions
  for insert to authenticated with check (private.is_ffm());

-- ---------------------------------------------------------------------------
-- Batch shape (all keys optional):
-- {
--   "daily":      [{source, metric_key, date, dimension, dimension_value, value}],
--   "period":     [{source, metric_key, period_start, period_end, dimension, dimension_value, value}],
--   "posts":      [{platform, external_id, published_at, format, caption, summary, permalink,
--                   views, reach, interactions, likes, comments, saves, shares}],
--   "snapshots":  [{platform, snapshot_date, period_start, breakdown_type, bucket, share}],
--   "adCampaigns":[{source, external_campaign_id, name, objective, status, start_date, end_date}],
--   "adDaily":    [{external_campaign_id, date, spend, impressions, reach, clicks, leads}]
-- }
-- ---------------------------------------------------------------------------

-- Incoming rows as typed record sets.
create or replace function private.batch_daily(p jsonb)
returns table (source public.data_source, metric_key text, date date, dimension text, dimension_value text, value numeric)
language sql immutable set search_path = '' as $$
  select x.source, x.metric_key, x.date, coalesce(x.dimension, ''), coalesce(x.dimension_value, ''), x.value
  from jsonb_to_recordset(coalesce(p -> 'daily', '[]')) as x(
    source public.data_source, metric_key text, date date, dimension text, dimension_value text, value numeric);
$$;

create or replace function private.batch_period(p jsonb)
returns table (source public.data_source, metric_key text, period_start date, period_end date, dimension text, dimension_value text, value numeric)
language sql immutable set search_path = '' as $$
  select x.source, x.metric_key, x.period_start, x.period_end, coalesce(x.dimension, ''), coalesce(x.dimension_value, ''), x.value
  from jsonb_to_recordset(coalesce(p -> 'period', '[]')) as x(
    source public.data_source, metric_key text, period_start date, period_end date, dimension text, dimension_value text, value numeric);
$$;

create or replace function private.batch_posts(p jsonb)
returns table (platform public.data_source, external_id text, published_at timestamptz, format public.post_format,
               caption text, summary text, permalink text, views numeric, reach numeric, interactions numeric,
               likes numeric, comments numeric, saves numeric, shares numeric)
language sql immutable set search_path = '' as $$
  select * from jsonb_to_recordset(coalesce(p -> 'posts', '[]')) as x(
    platform public.data_source, external_id text, published_at timestamptz, format public.post_format,
    caption text, summary text, permalink text, views numeric, reach numeric, interactions numeric,
    likes numeric, comments numeric, saves numeric, shares numeric);
$$;

create or replace function private.batch_snapshots(p jsonb)
returns table (platform public.data_source, snapshot_date date, period_start date, breakdown_type public.breakdown_type, bucket text, share numeric)
language sql immutable set search_path = '' as $$
  select * from jsonb_to_recordset(coalesce(p -> 'snapshots', '[]')) as x(
    platform public.data_source, snapshot_date date, period_start date, breakdown_type public.breakdown_type, bucket text, share numeric);
$$;

create or replace function private.batch_campaigns(p jsonb)
returns table (source public.data_source, external_campaign_id text, name text, objective text, status text, start_date date, end_date date)
language sql immutable set search_path = '' as $$
  select coalesce(x.source, 'meta_ads'), x.external_campaign_id, x.name, x.objective, x.status, x.start_date, x.end_date
  from jsonb_to_recordset(coalesce(p -> 'adCampaigns', '[]')) as x(
    source public.data_source, external_campaign_id text, name text, objective text, status text, start_date date, end_date date);
$$;

create or replace function private.batch_ad_daily(p jsonb)
returns table (external_campaign_id text, date date, spend numeric, impressions numeric, reach numeric, clicks numeric, leads numeric)
language sql immutable set search_path = '' as $$
  select * from jsonb_to_recordset(coalesce(p -> 'adDaily', '[]')) as x(
    external_campaign_id text, date date, spend numeric, impressions numeric, reach numeric, clicks numeric, leads numeric);
$$;

grant execute on function private.batch_daily(jsonb), private.batch_period(jsonb), private.batch_posts(jsonb),
  private.batch_snapshots(jsonb), private.batch_campaigns(jsonb), private.batch_ad_daily(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Preview: how many incoming rows already exist, and how many would change.
-- ---------------------------------------------------------------------------

create or replace function public.preview_upload(p_client_id uuid, p_batch jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'daily', (
      select jsonb_build_object('incoming', count(*), 'existing', count(m.id),
                                'changed', count(m.id) filter (where m.value is distinct from i.value))
      from private.batch_daily(p_batch) i
      left join public.metrics_daily m
        on m.client_id = p_client_id and m.source = i.source and m.metric_key = i.metric_key and m.date = i.date
       and m.dimension = i.dimension and m.dimension_value = i.dimension_value),
    'period', (
      select jsonb_build_object('incoming', count(*), 'existing', count(m.id),
                                'changed', count(m.id) filter (where m.value is distinct from i.value))
      from private.batch_period(p_batch) i
      left join public.metrics_period m
        on m.client_id = p_client_id and m.source = i.source and m.metric_key = i.metric_key
       and m.period_start = i.period_start and m.period_end = i.period_end
       and m.dimension = i.dimension and m.dimension_value = i.dimension_value),
    'posts', (
      select jsonb_build_object('incoming', count(*), 'existing', count(m.id),
                                'changed', count(m.id) filter (where (m.views, m.interactions) is distinct from (i.views, i.interactions)))
      from private.batch_posts(p_batch) i
      left join public.posts m on m.client_id = p_client_id and m.platform = i.platform and m.external_id = i.external_id),
    'snapshots', (
      -- Snapshots replace the whole breakdown for that platform and date.
      select jsonb_build_object(
        'incoming', (select count(*) from private.batch_snapshots(p_batch)),
        'existing', count(*), 'changed', count(*))
      from public.audience_snapshots m
      where m.client_id = p_client_id
        and (m.platform, m.snapshot_date, m.breakdown_type) in (
          select distinct s.platform, s.snapshot_date, s.breakdown_type from private.batch_snapshots(p_batch) s)),
    'adDaily', (
      select jsonb_build_object('incoming', count(*), 'existing', count(m.id),
                                'changed', count(m.id) filter (where (m.spend, m.impressions, m.clicks, m.leads, m.reach)
                                                                 is distinct from (i.spend, i.impressions, i.clicks, i.leads, i.reach)))
      from private.batch_ad_daily(p_batch) i
      left join public.ad_campaigns c on c.client_id = p_client_id and c.source = 'meta_ads' and c.external_campaign_id = i.external_campaign_id
      left join public.ad_metrics_daily m on m.campaign_id = c.id and m.date = i.date)
  );
$$;

-- ---------------------------------------------------------------------------
-- Commit
-- ---------------------------------------------------------------------------

create or replace function public.commit_upload(
  p_upload_id    uuid,
  p_client_id    uuid,
  p_source       public.data_source,
  p_kind         text,
  p_file_name    text,
  p_storage_path text,
  p_parser       text,
  p_period_start date,
  p_period_end   date,
  p_batch        jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n_total int;
  n_prev  int;
  inserted int := 0;
  updated  int := 0;
  v_summary jsonb := '{}';
begin
  if not private.is_ffm() then
    raise exception 'Only Flow Forward Media staff can upload data' using errcode = '42501';
  end if;

  insert into public.uploads (id, client_id, source, uploaded_by, file_name, storage_path, parser, kind,
                              period_start, period_end, status)
  values (p_upload_id, p_client_id, p_source, (select auth.uid()), p_file_name, p_storage_path, p_parser, p_kind,
          p_period_start, p_period_end, 'running');

  -- metrics_daily -----------------------------------------------------------
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'metrics_daily', to_jsonb(m)
  from public.metrics_daily m
  join private.batch_daily(p_batch) i
    on m.client_id = p_client_id and m.source = i.source and m.metric_key = i.metric_key and m.date = i.date
   and m.dimension = i.dimension and m.dimension_value = i.dimension_value;
  get diagnostics n_prev = row_count;

  insert into public.metrics_daily (client_id, source, metric_key, date, dimension, dimension_value, value, upload_id)
  select p_client_id, i.source, i.metric_key, i.date, i.dimension, i.dimension_value, i.value, p_upload_id
  from private.batch_daily(p_batch) i
  on conflict (client_id, source, metric_key, date, dimension, dimension_value)
  do update set value = excluded.value, upload_id = excluded.upload_id, sync_run_id = null;
  get diagnostics n_total = row_count;
  v_summary := v_summary || jsonb_build_object('daily', jsonb_build_object('inserted', n_total - n_prev, 'updated', n_prev));
  inserted := inserted + n_total - n_prev; updated := updated + n_prev;

  -- metrics_period ----------------------------------------------------------
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'metrics_period', to_jsonb(m)
  from public.metrics_period m
  join private.batch_period(p_batch) i
    on m.client_id = p_client_id and m.source = i.source and m.metric_key = i.metric_key
   and m.period_start = i.period_start and m.period_end = i.period_end
   and m.dimension = i.dimension and m.dimension_value = i.dimension_value;
  get diagnostics n_prev = row_count;

  insert into public.metrics_period (client_id, source, metric_key, period_start, period_end, dimension, dimension_value, value, upload_id)
  select p_client_id, i.source, i.metric_key, i.period_start, i.period_end, i.dimension, i.dimension_value, i.value, p_upload_id
  from private.batch_period(p_batch) i
  on conflict (client_id, source, metric_key, period_start, period_end, dimension, dimension_value)
  do update set value = excluded.value, upload_id = excluded.upload_id, sync_run_id = null;
  get diagnostics n_total = row_count;
  v_summary := v_summary || jsonb_build_object('period', jsonb_build_object('inserted', n_total - n_prev, 'updated', n_prev));
  inserted := inserted + n_total - n_prev; updated := updated + n_prev;

  -- posts -------------------------------------------------------------------
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'posts', to_jsonb(m)
  from public.posts m
  join private.batch_posts(p_batch) i on m.client_id = p_client_id and m.platform = i.platform and m.external_id = i.external_id;
  get diagnostics n_prev = row_count;

  insert into public.posts (client_id, platform, external_id, published_at, format, caption, summary, permalink,
                            views, reach, interactions, likes, comments, saves, shares, upload_id)
  select p_client_id, i.platform, i.external_id, i.published_at, i.format, i.caption, i.summary, i.permalink,
         i.views, i.reach, i.interactions, i.likes, i.comments, i.saves, i.shares, p_upload_id
  from private.batch_posts(p_batch) i
  on conflict (client_id, platform, external_id) do update set
    published_at = excluded.published_at, format = excluded.format, caption = excluded.caption,
    summary = excluded.summary, permalink = excluded.permalink, views = excluded.views, reach = excluded.reach,
    interactions = excluded.interactions, likes = excluded.likes, comments = excluded.comments,
    saves = excluded.saves, shares = excluded.shares, upload_id = excluded.upload_id, sync_run_id = null;
  get diagnostics n_total = row_count;
  v_summary := v_summary || jsonb_build_object('posts', jsonb_build_object('inserted', n_total - n_prev, 'updated', n_prev));
  inserted := inserted + n_total - n_prev; updated := updated + n_prev;

  -- audience_snapshots: replace the whole breakdown for each platform/date --
  with groups as (
    select distinct s.platform, s.snapshot_date, s.breakdown_type from private.batch_snapshots(p_batch) s
  ), removed as (
    delete from public.audience_snapshots m
    using groups g
    where m.client_id = p_client_id and m.platform = g.platform
      and m.snapshot_date = g.snapshot_date and m.breakdown_type = g.breakdown_type
    returning m.*
  )
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'audience_snapshots', to_jsonb(removed) from removed;
  get diagnostics n_prev = row_count;

  insert into public.audience_snapshots (client_id, platform, snapshot_date, period_start, breakdown_type, bucket, share, upload_id)
  select p_client_id, i.platform, i.snapshot_date, i.period_start, i.breakdown_type, i.bucket, i.share, p_upload_id
  from private.batch_snapshots(p_batch) i;
  get diagnostics n_total = row_count;
  v_summary := v_summary || jsonb_build_object('snapshots', jsonb_build_object('inserted', n_total, 'replaced', n_prev));
  inserted := inserted + n_total; updated := updated + n_prev;

  -- ad_campaigns: keep the widest known date range ---------------------------
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'ad_campaigns', to_jsonb(m)
  from public.ad_campaigns m
  join private.batch_campaigns(p_batch) i
    on m.client_id = p_client_id and m.source = i.source and m.external_campaign_id = i.external_campaign_id;

  insert into public.ad_campaigns (client_id, source, external_campaign_id, name, objective, status, start_date, end_date, created_by_upload_id)
  select p_client_id, i.source, i.external_campaign_id, i.name, i.objective, i.status, i.start_date, i.end_date, p_upload_id
  from private.batch_campaigns(p_batch) i
  on conflict (client_id, source, external_campaign_id) do update set
    name = excluded.name,
    objective = coalesce(excluded.objective, public.ad_campaigns.objective),
    status = coalesce(excluded.status, public.ad_campaigns.status),
    start_date = least(public.ad_campaigns.start_date, excluded.start_date),
    end_date = case
      when excluded.end_date is null or public.ad_campaigns.end_date is null then null
      else greatest(public.ad_campaigns.end_date, excluded.end_date) end;

  -- ad_metrics_daily ----------------------------------------------------------
  insert into public.upload_revisions (upload_id, table_name, previous)
  select p_upload_id, 'ad_metrics_daily', to_jsonb(m)
  from private.batch_ad_daily(p_batch) i
  join public.ad_campaigns c on c.client_id = p_client_id and c.source = 'meta_ads' and c.external_campaign_id = i.external_campaign_id
  join public.ad_metrics_daily m on m.campaign_id = c.id and m.date = i.date;
  get diagnostics n_prev = row_count;

  insert into public.ad_metrics_daily (client_id, campaign_id, date, spend, impressions, reach, clicks, leads, upload_id)
  select p_client_id, c.id, i.date, i.spend, i.impressions, i.reach, i.clicks, i.leads, p_upload_id
  from private.batch_ad_daily(p_batch) i
  join public.ad_campaigns c on c.client_id = p_client_id and c.source = 'meta_ads' and c.external_campaign_id = i.external_campaign_id
  on conflict (campaign_id, date) do update set
    spend = excluded.spend, impressions = excluded.impressions, reach = excluded.reach,
    clicks = excluded.clicks, leads = excluded.leads, upload_id = excluded.upload_id, sync_run_id = null;
  get diagnostics n_total = row_count;
  v_summary := v_summary || jsonb_build_object('adDaily', jsonb_build_object('inserted', n_total - n_prev, 'updated', n_prev));
  inserted := inserted + n_total - n_prev; updated := updated + n_prev;

  update public.uploads
     set status = 'succeeded', rows_inserted = inserted, rows_updated = updated, summary = v_summary
   where id = p_upload_id;

  insert into public.audit_log (actor_id, client_id, action, details)
  values ((select auth.uid()), p_client_id, 'upload.commit',
          jsonb_build_object('upload_id', p_upload_id, 'source', p_source, 'kind', p_kind, 'file_name', p_file_name,
                             'inserted', inserted, 'updated', updated));

  return jsonb_build_object('upload_id', p_upload_id, 'inserted', inserted, 'updated', updated, 'summary', v_summary);
end;
$$;

-- ---------------------------------------------------------------------------
-- Rollback
--
-- Removes every row this upload wrote, then restores what it overwrote. Rows a
-- later upload has since replaced are left alone (the newer data wins); they
-- are reported as "kept".
-- ---------------------------------------------------------------------------

create or replace function public.rollback_upload(p_upload_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  n int;
  removed int := 0;
  restored int := 0;
  revisions int := 0;
begin
  if not private.is_ffm() then
    raise exception 'Only Flow Forward Media staff can roll back uploads' using errcode = '42501';
  end if;

  select * into v_upload from public.uploads where id = p_upload_id for update;
  if not found then
    raise exception 'Upload not found';
  end if;
  if v_upload.status <> 'succeeded' then
    raise exception 'Only a successful upload can be rolled back (this one is %)', v_upload.status;
  end if;

  delete from public.ad_metrics_daily where upload_id = p_upload_id;   get diagnostics n = row_count; removed := removed + n;
  delete from public.metrics_daily where upload_id = p_upload_id;      get diagnostics n = row_count; removed := removed + n;
  delete from public.metrics_period where upload_id = p_upload_id;     get diagnostics n = row_count; removed := removed + n;
  delete from public.posts where upload_id = p_upload_id;              get diagnostics n = row_count; removed := removed + n;
  delete from public.audience_snapshots where upload_id = p_upload_id; get diagnostics n = row_count; removed := removed + n;

  select count(*) into revisions from public.upload_revisions where upload_id = p_upload_id and table_name <> 'ad_campaigns';

  insert into public.metrics_daily overriding system value
  select (jsonb_populate_record(null::public.metrics_daily, r.previous)).*
  from public.upload_revisions r where r.upload_id = p_upload_id and r.table_name = 'metrics_daily'
  on conflict do nothing;
  get diagnostics n = row_count; restored := restored + n;

  insert into public.metrics_period overriding system value
  select (jsonb_populate_record(null::public.metrics_period, r.previous)).*
  from public.upload_revisions r where r.upload_id = p_upload_id and r.table_name = 'metrics_period'
  on conflict do nothing;
  get diagnostics n = row_count; restored := restored + n;

  insert into public.posts
  select (jsonb_populate_record(null::public.posts, r.previous)).*
  from public.upload_revisions r where r.upload_id = p_upload_id and r.table_name = 'posts'
  on conflict do nothing;
  get diagnostics n = row_count; restored := restored + n;

  -- A snapshot group a later upload has replaced is kept as is.
  insert into public.audience_snapshots overriding system value
  select prev.*
  from public.upload_revisions r
  cross join lateral jsonb_populate_record(null::public.audience_snapshots, r.previous) prev
  where r.upload_id = p_upload_id and r.table_name = 'audience_snapshots'
    and not exists (
      select 1 from public.audience_snapshots s
      where s.client_id = prev.client_id and s.platform = prev.platform
        and s.snapshot_date = prev.snapshot_date and s.breakdown_type = prev.breakdown_type)
  on conflict do nothing;
  get diagnostics n = row_count; restored := restored + n;

  -- Campaign details go back to how they were, and campaigns this upload
  -- created are removed if no data points to them any more.
  update public.ad_campaigns c
     set name = prev.name, objective = prev.objective, status = prev.status,
         start_date = prev.start_date, end_date = prev.end_date
    from public.upload_revisions r
    cross join lateral jsonb_populate_record(null::public.ad_campaigns, r.previous) prev
   where r.upload_id = p_upload_id and r.table_name = 'ad_campaigns' and c.id = prev.id;

  insert into public.ad_metrics_daily overriding system value
  select (jsonb_populate_record(null::public.ad_metrics_daily, r.previous)).*
  from public.upload_revisions r where r.upload_id = p_upload_id and r.table_name = 'ad_metrics_daily'
  on conflict do nothing;
  get diagnostics n = row_count; restored := restored + n;

  delete from public.ad_campaigns c
   where c.created_by_upload_id = p_upload_id
     and not exists (select 1 from public.ad_metrics_daily m where m.campaign_id = c.id)
     and not exists (select 1 from public.metrics_period m
                      where m.client_id = c.client_id and m.dimension = 'campaign' and m.dimension_value = c.external_campaign_id);

  update public.uploads
     set status = 'rolled_back', rolled_back_at = now(), rolled_back_by = (select auth.uid())
   where id = p_upload_id;

  insert into public.audit_log (actor_id, client_id, action, details)
  values ((select auth.uid()), v_upload.client_id, 'upload.rollback',
          jsonb_build_object('upload_id', p_upload_id, 'removed', removed, 'restored', restored,
                             'kept', revisions - restored));

  return jsonb_build_object('removed', removed, 'restored', restored, 'kept', revisions - restored);
end;
$$;

revoke all on function public.preview_upload(uuid, jsonb), public.commit_upload(uuid, uuid, public.data_source, text, text, text, text, date, date, jsonb),
  public.rollback_upload(uuid) from public, anon;
grant execute on function public.preview_upload(uuid, jsonb), public.commit_upload(uuid, uuid, public.data_source, text, text, text, text, date, date, jsonb),
  public.rollback_upload(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Private storage bucket for original upload files (Supabase only).
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('uploads', 'uploads', false, 5242880)
    on conflict (id) do nothing;

    execute $p$
      create policy "ffm read uploads" on storage.objects for select to authenticated
      using (bucket_id = 'uploads' and private.is_ffm())
    $p$;
    execute $p$
      create policy "ffm write uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'uploads' and private.is_ffm())
    $p$;
    execute $p$
      create policy "admin delete uploads" on storage.objects for delete to authenticated
      using (bucket_id = 'uploads' and private.is_ffm_admin())
    $p$;
  end if;
end;
$$;
