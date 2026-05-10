-- Optional periodic cleanup for idempotency / dedupe tables (run via pg_cron or external scheduler).
-- Retention tuned for webhook replay windows vs disk usage.

create or replace function logline_cleanup_old_webhook_state()
returns void
language plpgsql
as $$
begin
  delete from processed_webhook_deliveries
   where processed_at < now() - interval '90 days';

  delete from pr_head_analysis_dedupe
   where processed_at < now() - interval '365 days';
end;
$$;
