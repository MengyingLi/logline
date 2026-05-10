# logline-app

Private GitHub App scaffold for PR-time analytics suggestions.

## Status

Production-oriented defaults: NextAuth (GitHub OAuth) for `/dashboard`, signed optional install `state`, Stripe-backed billing webhooks, webhook idempotency + PR dedupe tables (see migrations), and ingest limits.

## Local setup

1. Install dependencies in this app directory.
2. Copy `.env.example` to `.env.local` and fill GitHub App + **GitHub OAuth App** + NextAuth + Supabase (+ Stripe optional).
3. Apply Supabase migrations under `supabase/migrations/` (`0002_hardening.sql` adds RPC `get_event_counts_for_repo`, webhook dedupe, PR dedupe, `repo_feedback`; `0003_webhook_state_ttl_cleanup.sql` adds `logline_cleanup_old_webhook_state()` for optional scheduled retention).
4. Run `npm run dev`.

Feedback from PR comments is stored in the `repo_feedback` table (no filesystem store).

See `.env.example` for `FANOUT_CUSTOM_URL_ALLOWLIST` (optional restrict-list for custom HTTPS fan-out URLs).

## Operations

- **Logs:** Structured JSON via [pino](https://github.com/pinojs/pino). Set `LOG_LEVEL=debug` for verbose server logs.
- **Health:** `GET /api/health` returns `{ ok, checks: { server, database } }` — HTTP 503 if the DB probe fails.
- **Migrations:** Apply through `0004_add_rls.sql` — enables Postgres RLS on app tables (service role still bypasses RLS; anon/authenticated keys get no row access).
- **Tracing:** Responses under `/api/*` and `/dashboard/*` include `x-request-id` (echoed from the incoming header or generated).
- **GitHub webhooks:** If `X-GitHub-Delivery` is missing, idempotency uses `sha256:<body-hash>` after signature verification (same payload redelivers dedupe correctly).
