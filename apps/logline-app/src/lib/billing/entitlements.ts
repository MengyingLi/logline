import { getInstallation, getReposByInstallation, getRepo } from '@/lib/db';

const FREE_REPO_LIMIT = 3;

/**
 * Returns true if this installation is allowed to analyze this repo.
 * Free plan: up to FREE_REPO_LIMIT enrolled repos.
 * Pro/Enterprise: unlimited.
 */
export async function checkEntitlement(
  installationId: number,
  repoFullName: string
): Promise<boolean> {
  try {
    const installation = await getInstallation(installationId);
    if (!installation) {
      // Unknown installation — allow and it will be enrolled lazily on next webhook
      return true;
    }
    if (installation.suspended_at) return false;
    if (installation.plan !== 'free') return true;

    // Free plan: check if this specific repo is already enrolled (or fits within limit)
    const [owner, name] = repoFullName.split('/');
    const existing = await getRepo(owner, name);
    if (existing) return true; // already enrolled, allow

    const repos = await getReposByInstallation(installationId);
    return repos.length < FREE_REPO_LIMIT;
  } catch (err) {
    console.error('[logline-app] entitlement check error', err);
    return true; // fail open so a DB hiccup doesn't block reviews
  }
}
