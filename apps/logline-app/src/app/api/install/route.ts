import { NextRequest, NextResponse } from 'next/server';
import { getGitHubInstallation, listInstallationRepos } from '@/lib/github';
import { upsertInstallation, enrollRepo } from '@/lib/db';

/**
 * GitHub App installation callback.
 * GitHub redirects here after install: ?installation_id=123&setup_action=install
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const installationId = req.nextUrl.searchParams.get('installation_id');
  if (!installationId) {
    return NextResponse.json({ error: 'missing installation_id' }, { status: 400 });
  }

  const id = parseInt(installationId, 10);

  try {
    // Fetch installation metadata from GitHub
    const installation = await getGitHubInstallation(id);

    // Persist installation
    await upsertInstallation({
      id,
      account_login: installation.account.login,
      account_type: installation.account.type,
    });

    // Enroll all accessible repos (creates API key for each)
    const repos = await listInstallationRepos(id);
    await Promise.all(
      repos.map((r) => enrollRepo(id, r.owner, r.name).catch(() => null))
    );

    // Redirect to the org dashboard
    const dashboardUrl = new URL(`/dashboard/${installation.account.login}`, req.url);
    return NextResponse.redirect(dashboardUrl);
  } catch (err) {
    console.error('[logline-app] install handler error', err);
    return NextResponse.json({ error: 'Installation setup failed' }, { status: 500 });
  }
}
