import pRetry from 'p-retry';

export interface RetryOptions {
  retries?: number;
  minTimeoutMs?: number;
  factor?: number;
}

/** Retry transient failures (network / 5xx). Caller decides what is retryable. */
export async function retryTransient<T>(
  fn: () => Promise<T>,
  isTransientFailure: (err: unknown) => boolean,
  options: RetryOptions = {}
): Promise<T> {
  const retries = options.retries ?? 3;
  const minTimeoutMs = options.minTimeoutMs ?? 400;
  const factor = options.factor ?? 2;

  return pRetry(fn, {
    retries,
    minTimeout: minTimeoutMs,
    factor,
    randomize: true,
    shouldRetry: (failedAttemptErr) => isTransientFailure(failedAttemptErr),
  });
}
