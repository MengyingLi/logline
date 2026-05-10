import { createHash } from 'node:crypto';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

const stores = {
  bool: new Map<string, CacheEntry<boolean>>(),
};

function prune(store: Map<string, CacheEntry<unknown>>): void {
  const now = Date.now();
  if (store.size <= MAX_ENTRIES) {
    for (const [k, v] of store) {
      if (v.expiresAt <= now) store.delete(k);
    }
    return;
  }
  const entries = [...store.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
  const drop = Math.ceil(entries.length / 10);
  for (let i = 0; i < drop; i++) {
    store.delete(entries[i]![0]);
  }
}

function stableKey(parts: string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Cache key scoped to token + account — avoids logging raw tokens. */
export function membershipCacheKey(accessToken: string, accountLogin: string, kind: 'view' | 'admin'): string {
  const tokenFp = createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
  return stableKey([tokenFp, accountLogin.toLowerCase(), kind]);
}

export function getCachedBoolean(key: string): boolean | undefined {
  const e = stores.bool.get(key);
  if (!e || e.expiresAt <= Date.now()) {
    if (e) stores.bool.delete(key);
    return undefined;
  }
  return e.value;
}

export function setCachedBoolean(key: string, value: boolean, ttlMs = DEFAULT_TTL_MS): void {
  prune(stores.bool);
  stores.bool.set(key, { value, expiresAt: Date.now() + ttlMs });
}
