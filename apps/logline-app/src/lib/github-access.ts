/**
 * Verify the authenticated GitHub user may access dashboards / billing for an account_login
 * (GitHub App installation account — User or Organization).
 */

import { logger } from '@/lib/logger';
import { retryTransient } from '@/lib/retry';
import { CircuitBreaker } from '@/lib/circuit-breaker';
import { getCachedBoolean, membershipCacheKey, setCachedBoolean } from '@/lib/github-cache';

const githubApiBreaker = new CircuitBreaker({ threshold: 8, windowMs: 60_000, cooldownMs: 25_000 });

function logRateLimits(res: Response, context: string): void {
  const rem = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  if (rem === null) return;
  const n = parseInt(rem, 10);
  if (Number.isNaN(n)) return;
  if (n < 50) {
    logger.warn(
      { context, rateLimitRemaining: n, rateLimitReset: reset },
      'GitHub API rate limit low'
    );
  }
}

function isRetryableGitHubError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TypeError') return true;
  return /^github_5\d\d$/.test(err.message);
}

async function fetchWithRetry(url: string, init: RequestInit, context: string): Promise<Response> {
  if (githubApiBreaker.isOpen()) {
    logger.error({ context }, 'GitHub API circuit breaker open');
    throw new Error('github_circuit_open');
  }

  return retryTransient(
    async () => {
      const res = await fetch(url, init);
      logRateLimits(res, context);
      if (res.status >= 500) {
        githubApiBreaker.recordFailure();
        throw new Error(`github_${res.status}`);
      }
      githubApiBreaker.recordSuccess();
      return res;
    },
    isRetryableGitHubError,
    { retries: 3, minTimeoutMs: 300, factor: 2 }
  );
}

export async function fetchGitHubUser(accessToken: string): Promise<{ login: string } | null> {
  const res = await fetchWithRetry(
    'https://api.github.com/user',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
    'GET /user'
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { login?: string };
  return data.login ? { login: data.login } : null;
}

/** View dashboards: user owns the account, or has active org membership. */
export async function userCanViewInstallationAccount(
  accessToken: string,
  accountLogin: string,
  accountType: string
): Promise<boolean> {
  try {
    return await userCanViewInstallationAccountUncached(accessToken, accountLogin, accountType);
  } catch (e) {
    logger.error({ err: e, accountLogin }, 'GitHub access check failed (view)');
    return false;
  }
}

async function userCanViewInstallationAccountUncached(
  accessToken: string,
  accountLogin: string,
  accountType: string
): Promise<boolean> {
  const ck = `${membershipCacheKey(accessToken, accountLogin, 'view')}:${accountType}`;
  const hit = getCachedBoolean(ck);
  if (hit !== undefined) return hit;

  const me = await fetchGitHubUser(accessToken);
  if (!me) {
    setCachedBoolean(ck, false);
    return false;
  }
  if (me.login.toLowerCase() === accountLogin.toLowerCase()) {
    setCachedBoolean(ck, true);
    return true;
  }
  if (accountType === 'Organization') {
    const mem = await fetchWithRetry(
      `https://api.github.com/orgs/${encodeURIComponent(accountLogin)}/memberships/${encodeURIComponent(me.login)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      'GET /orgs/.../memberships'
    );
    if (!mem.ok) {
      setCachedBoolean(ck, false);
      return false;
    }
    const body = (await mem.json()) as { state?: string };
    const ok = body.state === 'active';
    setCachedBoolean(ck, ok);
    return ok;
  }
  setCachedBoolean(ck, false);
  return false;
}

/**
 * Install callback / privileged actions: user account must match, or org role admin/maintainer.
 */
export async function userCanAdministerInstallationAccount(
  accessToken: string,
  accountLogin: string,
  accountType: string
): Promise<boolean> {
  try {
    return await userCanAdministerInstallationAccountUncached(accessToken, accountLogin, accountType);
  } catch (e) {
    logger.error({ err: e, accountLogin }, 'GitHub access check failed (admin)');
    return false;
  }
}

async function userCanAdministerInstallationAccountUncached(
  accessToken: string,
  accountLogin: string,
  accountType: string
): Promise<boolean> {
  const ck = `${membershipCacheKey(accessToken, accountLogin, 'admin')}:${accountType}`;
  const hit = getCachedBoolean(ck);
  if (hit !== undefined) return hit;

  const me = await fetchGitHubUser(accessToken);
  if (!me) {
    setCachedBoolean(ck, false);
    return false;
  }
  if (accountType === 'User') {
    const ok = me.login.toLowerCase() === accountLogin.toLowerCase();
    setCachedBoolean(ck, ok);
    return ok;
  }
  if (accountType === 'Organization') {
    const mem = await fetchWithRetry(
      `https://api.github.com/orgs/${encodeURIComponent(accountLogin)}/memberships/${encodeURIComponent(me.login)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      'GET /orgs/.../memberships (admin)'
    );
    if (!mem.ok) {
      setCachedBoolean(ck, false);
      return false;
    }
    const body = (await mem.json()) as { state?: string; role?: string };
    if (body.state !== 'active') {
      setCachedBoolean(ck, false);
      return false;
    }
    const ok = body.role === 'admin' || body.role === 'maintainer';
    setCachedBoolean(ck, ok);
    return ok;
  }
  setCachedBoolean(ck, false);
  return false;
}
