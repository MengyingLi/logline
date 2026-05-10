-- Defense-in-depth: enable RLS so accidental use of anon/authenticated keys cannot read/write app tables.
-- The Node app uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS on Supabase-hosted Postgres.

alter table if exists installations enable row level security;
alter table if exists repos enable row level security;
alter table if exists api_keys enable row level security;
alter table if exists events enable row level security;
alter table if exists processed_webhook_deliveries enable row level security;
alter table if exists pr_head_analysis_dedupe enable row level security;
alter table if exists repo_feedback enable row level security;
