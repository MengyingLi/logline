-- Webhook idempotency (GitHub delivery IDs)
create table if not exists processed_webhook_deliveries (
  delivery_id   text primary key,
  event_name    text not null default '',
  processed_at  timestamptz not null default now()
);

create index if not exists processed_webhook_deliveries_time_idx
  on processed_webhook_deliveries(processed_at desc);

-- PR head dedupe for analysis (replaces in-memory Set)
create table if not exists pr_head_analysis_dedupe (
  installation_id bigint not null,
  repo_full_name  text not null,
  pr_number       int not null,
  head_sha        text not null,
  processed_at    timestamptz not null default now(),
  primary key (installation_id, repo_full_name, pr_number, head_sha)
);

-- Feedback store (replaces file-backed store)
create table if not exists repo_feedback (
  repo_id    bigint primary key references repos(id) on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Aggregated event counts (replaces full-row scan in JS)
create or replace function get_event_counts_for_repo(p_repo_id bigint, p_days int)
returns table(event_name text, count bigint, last_seen timestamptz)
language sql
stable
as $$
  select e.event_name::text,
         count(*)::bigint,
         max(e.received_at)
    from events e
   where e.repo_id = p_repo_id
     and e.received_at >= (now() - (p_days || ' days')::interval)
   group by e.event_name;
$$;
