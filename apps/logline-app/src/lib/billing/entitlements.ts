import { getInstallation, getReposByInstallation, getRepo } from '@/lib/db';
import { DEFAULT_FREE_REPO_LIMIT, freePlanAllowsRepoAnalysis } from '@/lib/billing/free-plan-policy';

/**
 * Returns true if this installation is allowed to analyze this repo.
 * Free plan: up to DEFAULT_FREE_REPO_LIMIT enrolled repos.
 * Pro/Enterprise: unlimited.
 */
export async function checkEntitlement(
  installationId: number,
  repoFullName: string
): Promise<boolean> {
  try {
    const installation = await getInstallation(installationId);
    if (!installation) {
      // Unknown installation — allow PR automation until install row exists (first webhook)
      return true;
    }
    if (installation.suspended_at) return false;
    if (installation.plan !== 'free') return true;

    const [owner, name] = repoFullName.split('/');
    const existing = await getRepo(owner, name);
    const repos = await getReposByInstallation(installationId);

    return freePlanAllowsRepoAnalysis({
      enrolledRepoCount: repos.length,
      existingRepoEnrolled: Boolean(existing),
      freeRepoLimit: DEFAULT_FREE_REPO_LIMIT,
    });
  } catch (err) {
    console.error('[logline-app] entitlement check error', err);
    return false;
  }
}
