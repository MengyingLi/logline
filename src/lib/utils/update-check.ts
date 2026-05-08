import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REGISTRY_URL = 'https://registry.npmjs.org/logline-cli/latest';
const CACHE_FILE = path.join(os.homedir(), '.cache', 'logline', 'update.json');
const ONE_DAY_MS = 86_400_000;

interface VersionCache {
  version: string;
  checkedAt: number;
}

function readCache(): VersionCache | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as VersionCache;
  } catch {
    return null;
  }
}

function writeCache(data: VersionCache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch {}
}

function isNewer(remote: string, current: string): boolean {
  const r = remote.split('.').map(Number);
  const c = current.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((r[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Returns the latest version string if a newer version is available, else null.
 * Refreshes the npm registry cache at most once per day in the background.
 * Never throws — network errors are silently swallowed.
 */
export async function checkForUpdates(currentVersion: string): Promise<string | null> {
  const cached = readCache();
  const now = Date.now();

  // Refresh cache in background if stale or missing (fire-and-forget)
  if (!cached || now - cached.checkedAt > ONE_DAY_MS) {
    void (async () => {
      try {
        const res = await fetch(REGISTRY_URL, {
          signal: AbortSignal.timeout(4000),
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const data = await res.json() as { version?: string };
        if (typeof data.version === 'string') {
          writeCache({ version: data.version, checkedAt: now });
        }
      } catch {}
    })();
  }

  return cached && isNewer(cached.version, currentVersion) ? cached.version : null;
}
