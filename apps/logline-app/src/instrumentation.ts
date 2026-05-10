export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warnEnvMisconfiguration } = await import('@/lib/env-check');
    warnEnvMisconfiguration();
  }
}
