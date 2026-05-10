/** Pure rules for free-tier repo enrollment caps (used by entitlements + tests). */

export const DEFAULT_FREE_REPO_LIMIT = 3;

export function freePlanAllowsRepoAnalysis(args: {
  enrolledRepoCount: number;
  existingRepoEnrolled: boolean;
  freeRepoLimit: number;
}): boolean {
  if (args.existingRepoEnrolled) return true;
  return args.enrolledRepoCount < args.freeRepoLimit;
}
