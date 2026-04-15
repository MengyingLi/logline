export async function checkEntitlement(installationId: number, repoFullName: string): Promise<boolean> {
  // Placeholder entitlement logic. Replace with Stripe customer/subscription lookup.
  console.log('[logline-app] entitlement check', { installationId, repoFullName });
  return true;
}

