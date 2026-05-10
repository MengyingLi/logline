import type { Session } from 'next-auth';
import { getInstallation, getInstallationByLogin, getRepo } from '@/lib/db';
import { userCanViewInstallationAccount } from '@/lib/github-access';

export async function requireDashboardSession(session: Session | null): Promise<Session> {
  if (!session?.user || !(session as { accessToken?: string }).accessToken) {
    throw new Error('UNAUTHORIZED');
  }
  return session;
}

/** Ensures installation exists and the signed-in user may view this org/user dashboard. */
export async function assertCanViewOwnerDashboard(session: Session, owner: string): Promise<void> {
  const installation = await getInstallationByLogin(owner).catch(() => null);
  if (!installation) {
    throw new Error('NOT_FOUND');
  }
  const token = (session as { accessToken?: string }).accessToken;
  if (!token) throw new Error('UNAUTHORIZED');
  const ok = await userCanViewInstallationAccount(token, installation.account_login, installation.account_type);
  if (!ok) throw new Error('FORBIDDEN');
}

/** Ensures repo belongs to an installation the user can view. */
export async function assertCanViewRepoDashboard(session: Session, owner: string, repoName: string): Promise<void> {
  const repo = await getRepo(owner, repoName).catch(() => null);
  if (!repo) throw new Error('NOT_FOUND');
  const installation = await getInstallation(repo.installation_id);
  if (!installation) throw new Error('NOT_FOUND');
  const token = (session as { accessToken?: string }).accessToken;
  if (!token) throw new Error('UNAUTHORIZED');
  const ok = await userCanViewInstallationAccount(token, installation.account_login, installation.account_type);
  if (!ok) throw new Error('FORBIDDEN');
}
