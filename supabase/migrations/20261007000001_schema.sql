-- Flow Forward Media client portal: core schema.
--
-- Every data source lands in the same normalized shape. The core table is
-- metrics_daily; metric keys are defined in src/lib/metrics/config.ts.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- Meta organic is split into its two platforms so each can be enabled,
-- uploaded, and displayed independently. One Meta connection may feed both.
create type public.data_source as enum (
  'ga4',
  'meta_facebook',
  'meta_instagram',
  'meta_ads',
  'shopify',
  'tiktok',
  'linkedin'
);

create type public.user_role as enum ('ffm_admin', 'ffm_staff', 'client_viewer');

create type public.connection_status as enum ('not_connected', 'manual', 'active', 'error', 'expired');

create type public.post_format as enum ('reel', 'photo', 'carousel', 'link', 'video', 'story', 'text', 'other');

create type public.breakdown_type as enum (
  'age',
  'gender',
  'country',
  'city',
  'language',
  'discovery_surface',     -- Feed, Reels, Explore, Search...
  'follower_status',       -- follower vs non-follower share of views
  'follower_status_engagement', -- follower vs non-follower share of interactions
  'format_engagement'      -- share of interactions by content format
);

create type public.commentary_status as enum ('draft', 'published');

create type public.job_status as enum ('pending', 'running', 'succeeded', 'failed', 'rolled_back');

-- ---------------------------------------------------------------------------
-- Clients and users
-- ---------------------------------------------------------------------------

create table public.clients (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  logo_url        text,
  brand_color     text check (brand_color is null or brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  enabled_sources public.data_source[] not null default '{}',
  timezone        text not null default 'America/Chicago',
  market          text,             -- e.g. "West Texas", used to ground AI drafts
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One row per Supabase auth user. Created by trigger on signup/invite.
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null unique,
  full_name   text,
  role        public.user_role not null default 'client_viewer',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Many-to-many so one owner can see several businesses, and one client can
-- have several logins.
create table public.user_clients (
  user_id    uuid not null references public.users (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
create index user_clients_client_idx on public.user_clients (client_id);

-- ---------------------------------------------------------------------------
-- Connections and audit logs
-- ---------------------------------------------------------------------------

create table public.connections (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients (id) on delete cascade,
  source                public.data_source not null,
  external_account_id   text,          -- GA4 property ID, Page ID, ad account ID, shop domain...
  external_account_name text,
  -- Credentials live in Supabase Vault (encrypted at rest). Only the secret's
  -- id is stored here; decryption happens server-side with the service role.
  credentials_secret_id uuid,
  status                public.connection_status not null default 'manual',
  token_expires_at      timestamptz,
  last_synced_at        timestamptz,
  last_error            text,
  last_error_at         timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (client_id, source)
);

create table public.uploads (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  source        public.data_source not null,
  uploaded_by   uuid references public.users (id) on delete set null,
  file_name     text,
  storage_path  text,                  -- original file in Supabase Storage
  parser        text,                  -- which parser handled the file
  period_start  date,
  period_end    date,
  rows_inserted integer not null default 0,
  rows_updated  integer not null default 0,
  status        public.job_status not null default 'pending',
  error         text,
  rolled_back_at timestamptz,
  rolled_back_by uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index uploads_client_idx on public.uploads (client_id, created_at desc);

create table public.sync_runs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  connection_id uuid references public.connections (id) on delete set null,
  source        public.data_source not null,
  trigger       text not null default 'scheduled' check (trigger in ('scheduled', 'manual', 'backfill')),
  triggered_by  uuid references public.users (id) on delete set null,
  period_start  date not null,
  period_end    date not null,
  status        public.job_status not null default 'pending',
  rows_upserted integer not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index sync_runs_client_idx on public.sync_runs (client_id, started_at desc);

-- Every admin action (user invites, role changes, publishes, rollbacks...).
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references public.users (id) on delete set null,
  client_id  uuid references public.clients (id) on delete set null,
  action     text not null,
  details    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_client_idx on public.audit_log (client_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Metrics
-- ---------------------------------------------------------------------------

-- Core table. Additive metrics (views, sessions, spend) and component counts
-- for ratios (engaged_sessions + sessions) live here, one row per day.
-- dimension/dimension_value default to '' (not null) so the unique key works:
-- '' means "total for the day".
create table public.metrics_daily (
  id              bigint generated always as identity primary key,
  client_id       uuid not null references public.clients (id) on delete cascade,
  source          public.data_source not null,
  metric_key      text not null,
  date            date not null,
  dimension       text not null default '',
  dimension_value text not null default '',
  value           numeric not null,
  upload_id       uuid references public.uploads (id) on delete set null,
  sync_run_id     uuid references public.sync_runs (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint metrics_daily_unique
    unique (client_id, source, metric_key, date, dimension, dimension_value),
  constraint metrics_daily_dimension_pair
    check ((dimension = '') = (dimension_value = ''))
);
create index metrics_daily_lookup_idx on public.metrics_daily (client_id, date, metric_key);
create index metrics_daily_upload_idx on public.metrics_daily (upload_id) where upload_id is not null;

-- Metrics that are not additive across days (unique reach, for example) are
-- only correct for the exact period the platform reported. They are stored
-- per period and used when a selected range matches; otherwise the dashboard
-- falls back to daily values and labels the number as an estimate.
create table public.metrics_period (
  id              bigint generated always as identity primary key,
  client_id       uuid not null references public.clients (id) on delete cascade,
  source          public.data_source not null,
  metric_key      text not null,
  period_start    date not null,
  period_end      date not null,
  dimension       text not null default '',
  dimension_value text not null default '',
  value           numeric not null,
  upload_id       uuid references public.uploads (id) on delete set null,
  sync_run_id     uuid references public.sync_runs (id) on delete set null,
  updated_at      timestamptz not null default now(),
  constraint metrics_period_unique
    unique (client_id, source, metric_key, period_start, period_end, dimension, dimension_value),
  constraint metrics_period_range check (period_end >= period_start),
  constraint metrics_period_dimension_pair
    check ((dimension = '') = (dimension_value = ''))
);
create index metrics_period_lookup_idx on public.metrics_period (client_id, metric_key, period_start);

-- ---------------------------------------------------------------------------
-- Content, audience, ads
-- ---------------------------------------------------------------------------

create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  platform      public.data_source not null,
  external_id   text not null,
  published_at  timestamptz not null,
  format        public.post_format not null default 'other',
  caption       text,
  summary       text,           -- short label shown in tables
  permalink     text,
  thumbnail_url text,
  views         numeric,
  reach         numeric,
  interactions  numeric,
  likes         numeric,
  comments      numeric,
  saves         numeric,
  shares        numeric,
  upload_id     uuid references public.uploads (id) on delete set null,
  sync_run_id   uuid references public.sync_runs (id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (client_id, platform, external_id)
);
create index posts_client_date_idx on public.posts (client_id, published_at desc);

-- Share-of-audience snapshots (demographics, discovery, format mix).
-- share is a fraction 0..1. period_start is set for period-based breakdowns
-- like discovery surface; demographics are point-in-time (period_start null).
create table public.audience_snapshots (
  id             bigint generated always as identity primary key,
  client_id      uuid not null references public.clients (id) on delete cascade,
  platform       public.data_source not null,
  snapshot_date  date not null,
  period_start   date,
  breakdown_type public.breakdown_type not null,
  bucket         text not null,
  share          numeric not null check (share >= 0 and share <= 1),
  upload_id      uuid references public.uploads (id) on delete set null,
  sync_run_id    uuid references public.sync_runs (id) on delete set null,
  updated_at     timestamptz not null default now(),
  unique (client_id, platform, snapshot_date, breakdown_type, bucket)
);
create index audience_snapshots_lookup_idx on public.audience_snapshots (client_id, breakdown_type, snapshot_date desc);

create table public.ad_campaigns (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients (id) on delete cascade,
  source               public.data_source not null default 'meta_ads',
  external_campaign_id text not null,
  name                 text not null,
  objective            text,
  status               text,
  start_date           date,
  end_date             date,
  updated_at           timestamptz not null default now(),
  unique (client_id, source, external_campaign_id)
);

-- Daily ad delivery per campaign. CTR, CPL and frequency are never stored:
-- they are recomputed from these components for any range. Unique reach for
-- a range is stored in metrics_period (key ads_reach).
create table public.ad_metrics_daily (
  id          bigint generated always as identity primary key,
  client_id   uuid not null references public.clients (id) on delete cascade,
  campaign_id uuid not null references public.ad_campaigns (id) on delete cascade,
  date        date not null,
  spend       numeric not null default 0,
  impressions numeric not null default 0,
  reach       numeric not null default 0,   -- daily unique reach; NOT additive
  clicks      numeric not null default 0,
  leads       numeric not null default 0,
  upload_id   uuid references public.uploads (id) on delete set null,
  sync_run_id uuid references public.sync_runs (id) on delete set null,
  updated_at  timestamptz not null default now(),
  unique (campaign_id, date)
);
create index ad_metrics_daily_client_idx on public.ad_metrics_daily (client_id, date);

-- ---------------------------------------------------------------------------
-- Commentary and timeline annotations
-- ---------------------------------------------------------------------------

create table public.monthly_commentary (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  month               date not null check (extract(day from month) = 1),
  headline            text,
  summary             text,
  -- { "meta_facebook": { "headline": "...", "body": "..." }, ... }
  platform_narratives jsonb not null default '{}',
  -- Section intros keyed by module (content, demographics, discovery, ...)
  section_notes       jsonb not null default '{}',
  conclusion          text,
  status              public.commentary_status not null default 'draft',
  author_id           uuid references public.users (id) on delete set null,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, month)
);

create table public.annotations (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  date        date not null,
  label       text not null,
  description text,
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index annotations_client_idx on public.annotations (client_id, date);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'clients', 'users', 'connections', 'metrics_daily', 'metrics_period', 'posts',
    'audience_snapshots', 'ad_campaigns', 'ad_metrics_daily', 'monthly_commentary'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()',
      t, t
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile row for every auth user
-- ---------------------------------------------------------------------------

-- New users always start as client_viewer with no linked clients, so they see
-- nothing until an admin links them. Roles are never taken from user-supplied
-- metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
