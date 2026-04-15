# logline-app

Private GitHub App scaffold for PR-time analytics suggestions.

## Status

- Webhook endpoint scaffolded: `src/app/api/webhooks/github/route.ts`
- Diff parser + analyzer scaffolded under `src/lib/analysis/`
- Review comment builders scaffolded under `src/lib/comments/`
- Billing/install/health endpoints scaffolded under `src/app/api/`

## Local setup

1. Install dependencies in this app directory.
2. Copy `.env.example` to `.env.local` and fill GitHub + Stripe values.
3. Run `npm run dev`.

Optional:

- `LOGLINE_FEEDBACK_STORE_PATH` to customize where feedback is persisted.
  Defaults to `.logline-app-feedback.json` in the app working directory.

This scaffold is intentionally minimal and needs real GitHub App auth, entitlement persistence, and production hardening before launch.

