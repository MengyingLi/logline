import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth-options';
import { getGitHubInstallation, isAllowedInstallSetupAction, listInstallationRepos } from '@/lib/github';
import { upsertInstallation, enrollRepo } from '@/lib/db';
import { userCanAdministerInstallationAccount } from '@/lib/github-access';
import { verifyInstallState } from '@/lib/install-state';
import { InstallQuerySchema } from '@/lib/validation/schemas';
import { logger } from '@/lib/logger';

/**
 * GitHub App installation callback.
 * GitHub redirects here after install: ?installation_id=123&setup_action=install
 *
 * Requires GitHub OAuth session and proof the user can administer the installation account.
 * Optional `state` query param: base64url(JSON { installationId, exp, sig }) where sig = HMAC-SHA256(secret, `${installationId}.${exp}`) for replay bounds.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const installationIdParam = req.nextUrl.searchParams.get('installation_id');
  const stateParam = req.nextUrl.searchParams.get('state');
  const setupAction = req.nextUrl.searchParams.get('setup_action');

  const queryParsed = InstallQuerySchema.safeParse({
    installation_id: installationIdParam ?? '',
    setup_action: setupAction,
    state: stateParam,
  });
  if (!queryParsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: queryParsed.error.flatten() }, { status: 400 });
  }

  if (!isAllowedInstallSetupAction(setupAction)) {
    return NextResponse.json({ error: 'invalid setup_action' }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const accessToken = (session as { accessToken?: string } | null)?.accessToken;
  if (!session?.user || !accessToken) {
    const url = new URL('/signin', req.url);
    url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }

  const id = parseInt(queryParsed.data.installation_id, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'invalid installation_id' }, { status: 400 });
  }

  if (stateParam && !verifyInstallState(id, stateParam)) {
    return NextResponse.json({ error: 'invalid or expired state' }, { status: 400 });
  }

  try {
    const installation = await getGitHubInstallation(id);

    const canAdmin = await userCanAdministerInstallationAccount(
      accessToken,
      installation.account.login,
      installation.account.type
    );
    if (!canAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await upsertInstallation({
      id,
      account_login: installation.account.login,
      account_type: installation.account.type,
    });

    const repos = await listInstallationRepos(id);
    await Promise.all(repos.map((r) => enrollRepo(id, r.owner, r.name).catch(() => null)));

    const dashboardUrl = new URL(`/dashboard/${installation.account.login}`, req.url);
    return NextResponse.redirect(dashboardUrl);
  } catch (err) {
    logger.error({ err }, 'install handler error');
    return NextResponse.json({ error: 'Installation setup failed' }, { status: 500 });
  }
}
