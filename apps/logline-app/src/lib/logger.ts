import pino from 'pino';

/**
 * Structured logs with redaction of common secret fields.
 * Set LOG_LEVEL=debug for verbose server logs (default info).
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'logline-app' },
  redact: {
    paths: [
      'accessToken',
      'access_token',
      'authorization',
      'Authorization',
      '*.accessToken',
      '*.access_token',
      'password',
      'secret',
      'stripe_signature',
    ],
    remove: false,
  },
});

/** Attach correlation id from middleware / incoming request. */
export function logWithRequestId(requestId: string) {
  return logger.child({ requestId });
}
