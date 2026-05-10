import { logger } from '@/lib/logger';

/**
 * Soft startup checks — logs warnings only (never throws) so CI/build stay green.
 * Call from instrumentation.ts once per runtime.
 */
export function warnEnvMisconfiguration(): void {
  const prodLike =
    process.env.VERCEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production';

  if (!process.env.NEXTAUTH_SECRET) {
    logger.warn('NEXTAUTH_SECRET is unset — sessions will not work');
  }
  if (!process.env.GITHUB_OAUTH_CLIENT_ID || !process.env.GITHUB_OAUTH_CLIENT_SECRET) {
    logger.warn('GitHub OAuth client env vars missing — dashboard sign-in disabled until configured');
  }
  if (prodLike) {
    if (process.env.GITHUB_OAUTH_CLIENT_ID?.startsWith('placeholder')) {
      logger.warn('GitHub OAuth appears to use placeholder client id — replace for production');
    }
    if (!process.env.GITHUB_WEBHOOK_SECRET) {
      logger.warn('GITHUB_WEBHOOK_SECRET unset — GitHub webhooks will fail closed');
    }
  }
}
