import { Octokit } from 'octokit';
import { createSign } from 'node:crypto';

export interface GitHubInstallation {
  id: number;
  account: { login: string; type: string };
}

/** Fetch installation metadata from GitHub using the App JWT. */
export async function getGitHubInstallation(installationId: number): Promise<GitHubInstallation> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = normalizePrivateKey(process.env.GITHUB_PRIVATE_KEY);
  if (!appId || !privateKey) throw new Error('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY');
  const jwt = createAppJwt(appId, privateKey);
  const res = await fetch(`https://api.github.com/app/installations/${installationId}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'logline-app',
    },
  });
  if (!res.ok) throw new Error(`GitHub installation fetch error: ${res.status}`);
  return res.json() as Promise<GitHubInstallation>;
}

/** List repos accessible under an installation. */
export async function listInstallationRepos(
  installationId: number
): Promise<Array<{ owner: string; name: string }>> {
  const octokit = await getInstallationOctokit(installationId);
  const repos: Array<{ owner: string; name: string }> = [];
  let page = 1;
  while (page <= 10) {
    const res = await octokit.request('GET /installation/repositories', {
      per_page: 100,
      page,
    });
    for (const r of res.data.repositories) {
      repos.push({ owner: r.owner.login, name: r.name });
    }
    if (res.data.repositories.length < 100) break;
    page++;
  }
  return repos;
}

export function getAppOctokit(token?: string): Octokit {
  return new Octokit(token ? { auth: token } : {});
}

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const fallbackToken = process.env.GITHUB_TOKEN;
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = normalizePrivateKey(process.env.GITHUB_PRIVATE_KEY);

  // Fallback for local debugging when app credentials are not configured.
  if (!appId || !privateKey) {
    if (!fallbackToken) throw new Error('Missing GitHub auth: set GITHUB_TOKEN or GitHub App credentials');
    return getAppOctokit(fallbackToken);
  }

  const jwt = createAppJwt(appId, privateKey);
  const token = await createInstallationToken(jwt, installationId);
  return getAppOctokit(token);
}

function normalizePrivateKey(raw?: string): string | null {
  if (!raw) return null;
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  };
  const headerB64 = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payloadB64 = base64UrlEncode(JSON.stringify(payload));
  const unsigned = `${headerB64}.${payloadB64}`;
  const signature = createSign('RSA-SHA256').update(unsigned).end().sign(privateKey);
  const signatureB64 = base64UrlFromBuffer(signature);
  return `${unsigned}.${signatureB64}`;
}

async function createInstallationToken(jwt: string, installationId: number): Promise<string> {
  const res = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${jwt}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'logline-app',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub installation token error: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error('GitHub installation token missing from response');
  return body.token;
}

function base64UrlEncode(input: string): string {
  return base64UrlFromBuffer(Buffer.from(input, 'utf8'));
}

function base64UrlFromBuffer(buf: Buffer): string {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

