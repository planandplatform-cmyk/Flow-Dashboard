-- Upload commit and rollback test. Runs after the demo seed is loaded.
-- Safe on a real database: everything is rolled back at the end.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/uploads.test.sql

begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-0000000000f1', 'uploader@uploads.test'),
  ('00000000-0000-4000-a000-0000000000f2', 'viewer@uploads.test');
update public.users set role = 'ffm_staff' where id = '00000000-0000-4000-a000-0000000000f1';
insert into public.user_clients (user_id, client_id)
values ('00000000-0000-4000-a000-0000000000f2', '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01');

-- Original seeded values we will overwrite. Kept as transaction-local
-- settings (not a temp table) so they stay readable after switching role on
-- Supabase, where the postgres user is not a superuser.
select
  set_config('uploads_test.fb_views_0720', (select value from public.metrics_daily
    where client_id = '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01' and source = 'meta_facebook'
      and metric_key = 'fb_views' and date = '2026-07-20' and dimension = '')::text, true),
  set_config('uploads_test.age_rows', (select count(*) from public.audience_snapshots
    where client_id = '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01' and breakdown_type = 'age')::text, true),
  set_config('uploads_test.daily_rows', (select count(*) from public.metrics_daily)::text, true),
  set_config('uploads_test.spend_0720', (select spend from public.ad_metrics_daily
    where client_id = '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01' and date = '2026-07-20')::text, true);

set local role authenticated;

-- A client viewer cannot commit.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000f2","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.commit_upload(gen_random_uuid(), '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01', 'meta_facebook', 'file', 'x.csv', null, 'test', null, null, '{}');
    raise exception 'FAIL: client viewer committed an upload';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-0000000000f1","role":"authenticated"}', true);

do $$
declare
  c constant uuid := '5f0c9a1e-7b2d-4c3e-9a41-0d6b8e2f1a01';
  a constant uuid := '00000000-0000-4000-d000-00000000000a';
  b constant uuid := '00000000-0000-4000-d000-00000000000b';
  batch_a jsonb := $j${
    "daily": [
      {"source":"meta_facebook","metric_key":"fb_views","date":"2026-07-20","value":11111},
      {"source":"meta_facebook","metric_key":"fb_views","date":"2026-07-21","value":22222},
      {"source":"meta_facebook","metric_key":"fb_views","date":"2026-09-01","value":5}
    ],
    "period": [{"source":"ga4","metric_key":"ga4_users","period_start":"2026-07-01","period_end":"2026-07-31","value":300}],
    "snapshots": [
      {"platform":"meta_instagram","snapshot_date":"2026-07-31","period_start":null,"breakdown_type":"age","bucket":"25-34","share":0.6},
      {"platform":"meta_instagram","snapshot_date":"2026-07-31","period_start":null,"breakdown_type":"age","bucket":"35-44","share":0.4}
    ],
    "adCampaigns": [
      {"source":"meta_ads","external_campaign_id":"seed-wieler-leadgen-2026-07","name":"Renamed","objective":null,"status":null,"start_date":"2026-07-14","end_date":"2026-08-06"},
      {"source":"meta_ads","external_campaign_id":"new-campaign","name":"New","objective":null,"status":null,"start_date":"2026-09-01","end_date":"2026-09-02"}
    ],
    "adDaily": [
      {"external_campaign_id":"seed-wieler-leadgen-2026-07","date":"2026-07-20","spend":999,"impressions":1,"reach":1,"clicks":0,"leads":0},
      {"external_campaign_id":"new-campaign","date":"2026-09-01","spend":5,"impressions":10,"reach":9,"clicks":1,"leads":0}
    ]
  }$j$;
  preview jsonb;
  res jsonb;
  o record;
begin
  select current_setting('uploads_test.fb_views_0720')::numeric as fb_views_0720,
         current_setting('uploads_test.age_rows')::bigint as age_rows,
         current_setting('uploads_test.daily_rows')::bigint as daily_rows,
         current_setting('uploads_test.spend_0720')::numeric as spend_0720
    into o;
  if o.fb_views_0720 is null or o.spend_0720 is null then
    raise exception 'FAIL: demo seed not loaded. Run supabase/seed/01-wieler-roofing.sql first.';
  end if;

  preview := public.preview_upload(c, batch_a);
  if (preview -> 'daily' ->> 'existing')::int <> 2 or (preview -> 'daily' ->> 'changed')::int <> 2 then
    raise exception 'FAIL: preview daily %', preview -> 'daily';
  end if;
  if (preview -> 'snapshots' ->> 'existing')::int <> o.age_rows then
    raise exception 'FAIL: preview snapshots %', preview -> 'snapshots';
  end if;
  if (preview -> 'adDaily' ->> 'existing')::int <> 1 then
    raise exception 'FAIL: preview adDaily %', preview -> 'adDaily';
  end if;

  res := public.commit_upload(a, c, 'meta_facebook', 'file', 'a.csv', null, 'test', '2026-07-01', '2026-09-02', batch_a);
  if (res ->> 'updated')::int <> 2 + o.age_rows + 1 then
    raise exception 'FAIL: commit A counts %', res;
  end if;
  if (select value from public.metrics_daily where client_id = c and metric_key = 'fb_views' and date = '2026-07-20' and dimension = '') <> 11111 then
    raise exception 'FAIL: A did not overwrite';
  end if;
  if (select count(*) from public.audience_snapshots where client_id = c and breakdown_type = 'age') <> 2 then
    raise exception 'FAIL: A did not replace the age breakdown';
  end if;
  if (select name from public.ad_campaigns where external_campaign_id = 'seed-wieler-leadgen-2026-07') <> 'Renamed' then
    raise exception 'FAIL: campaign not renamed';
  end if;

  -- Upload B overwrites one of A's rows.
  perform public.commit_upload(b, c, 'meta_facebook', 'file', 'b.csv', null, 'test', '2026-07-21', '2026-07-21',
    '{"daily":[{"source":"meta_facebook","metric_key":"fb_views","date":"2026-07-21","value":33333}]}');

  -- Roll back A: B's newer value stays, A's other rows go back to the seed.
  res := public.rollback_upload(a);
  if (res ->> 'kept')::int <> 1 then
    raise exception 'FAIL: rollback A should keep 1 row replaced by B: %', res;
  end if;
  if (select value from public.metrics_daily where client_id = c and metric_key = 'fb_views' and date = '2026-07-20' and dimension = '') <> o.fb_views_0720 then
    raise exception 'FAIL: rollback A did not restore 07-20';
  end if;
  if (select value from public.metrics_daily where client_id = c and metric_key = 'fb_views' and date = '2026-07-21' and dimension = '') <> 33333 then
    raise exception 'FAIL: rollback A clobbered B';
  end if;
  if exists (select 1 from public.metrics_daily where client_id = c and date = '2026-09-01') then
    raise exception 'FAIL: rollback A left a row it inserted';
  end if;
  if exists (select 1 from public.metrics_period where client_id = c and metric_key = 'ga4_users') then
    raise exception 'FAIL: rollback A left a period row';
  end if;
  if (select count(*) from public.audience_snapshots where client_id = c and breakdown_type = 'age') <> o.age_rows then
    raise exception 'FAIL: rollback A did not restore the age breakdown';
  end if;
  if (select spend from public.ad_metrics_daily where date = '2026-07-20') <> o.spend_0720 then
    raise exception 'FAIL: rollback A did not restore ad spend';
  end if;
  if (select name from public.ad_campaigns where external_campaign_id = 'seed-wieler-leadgen-2026-07') = 'Renamed' then
    raise exception 'FAIL: rollback A did not restore the campaign name';
  end if;
  if exists (select 1 from public.ad_campaigns where external_campaign_id = 'new-campaign') then
    raise exception 'FAIL: rollback A left the campaign it created';
  end if;

  -- Rolling back twice is refused.
  begin
    perform public.rollback_upload(a);
    raise exception 'FAIL: double rollback allowed';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- Roll back B: 07-21 returns to the seed value too.
  perform public.rollback_upload(b);
  if (select count(*) from public.metrics_daily) <> o.daily_rows then
    raise exception 'FAIL: row count after both rollbacks % <> %', (select count(*) from public.metrics_daily), o.daily_rows;
  end if;

  if (select count(*) from public.audit_log where action like 'upload.%') <> 4 then
    raise exception 'FAIL: audit log entries missing';
  end if;
end $$;

reset role;
rollback;

-- Only reached if every check above passed (any failure stops with an error).
select 'Upload tests passed' as result;
