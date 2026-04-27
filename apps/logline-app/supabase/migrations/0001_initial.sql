-- Logline Cloud — initial schema
-- Run with: supabase db push  (or apply manually via psql)

-- GitHub App installations (one per org/user)
create table installations (
  id           bigint primary key,          -- GitHub installation ID
  account_login text not null,
  account_type  text not null,              -- 'Organization' | 'User'
  plan          text not null default 'free', -- 'free' | 'pro' | 'enterprise'
  stripe_customer_id      text,
  stripe_subscription_id  text,
  installed_at  timestamptz not null default now(),
  suspended_at  timestamptz
);

-- Repos enrolled under an installation
create table repos (
  id                        bigserial primary key,
  installation_id           bigint not null references installations(id) on delete cascade,
  owner                     text not null,
  name                      text not null,
  -- Stored tracking plan JSON (synced on each PR merge by logline-app)
  tracking_plan             jsonb,
  tracking_plan_updated_at  timestamptz,
  -- Fan-out destinations (Path B): { segment: {...}, posthog: {...}, custom: {...} }
  fanout_config             jsonb,
  enrolled_at               timestamptz not null default now(),
  unique(owner, name)
);

-- Ingest API keys (one or more per repo)
create table api_keys (
  id          bigserial primary key,
  repo_id     bigint not null references repos(id) on delete cascade,
  name        text not null default 'default',
  key         text not null unique,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- Raw event stream (Path A — own dashboard)
create table events (
  id           bigserial primary key,
  repo_id      bigint not null references repos(id) on delete cascade,
  event_name   text not null,
  properties   jsonb,
  environment  text not null default 'production',
  received_at  timestamptz not null default now()
);

-- Indexes
create index events_repo_name_idx  on events(repo_id, event_name);
create index events_repo_time_idx  on events(repo_id, received_at desc);
create index api_keys_key_idx      on api_keys(key) where revoked_at is null;
