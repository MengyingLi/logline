import type { TrackingPlan } from '@logline/cli';

export async function syncTrackingPlan(args: {
  octokit: any;
  owner: string;
  repo: string;
  baseBranch: string;
  implementedEvents: string[];
}): Promise<void> {
  const uniqueImplemented = Array.from(new Set(args.implementedEvents.map((x) => x.toLowerCase())));
  if (uniqueImplemented.length === 0) return;

  const path = '.logline/tracking-plan.json';
  const existing = await getFileFromRepo(args.octokit, args.owner, args.repo, args.baseBranch, path);
  const plan: TrackingPlan = existing ? parseTrackingPlan(existing.content) : createEmptyPlan();

  let changed = false;
  const nowIso = new Date().toISOString();
  for (const event of plan.events) {
    if (!uniqueImplemented.includes(event.name.toLowerCase())) continue;
    if (event.status !== 'implemented') {
      event.status = 'implemented';
      event.lastSeen = nowIso;
      changed = true;
    }
  }
  if (!changed) return;
  plan.coverage = recalcCoverage(plan);
  plan.generatedAt = nowIso;
  plan.generatedBy = 'logline-app';

  const branch = `logline/sync-tracking-plan-${Date.now()}`;
  await createBranch(args.octokit, args.owner, args.repo, args.baseBranch, branch);
  const encoded = Buffer.from(JSON.stringify(plan, null, 2), 'utf8').toString('base64');

  await args.octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
    owner: args.owner,
    repo: args.repo,
    path,
    branch,
    message: 'chore: sync Logline tracking plan after merge',
    content: encoded,
    sha: existing?.sha,
  });

  await args.octokit.request('POST /repos/{owner}/{repo}/pulls', {
    owner: args.owner,
    repo: args.repo,
    title: 'chore: Sync Logline tracking plan',
    head: branch,
    base: args.baseBranch,
    body: buildSyncBody(uniqueImplemented),
  });
}

async function getFileFromRepo(
  octokit: any,
  owner: string,
  repo: string,
  branch: string,
  filePath: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: filePath,
      ref: branch,
    });
    const data = res.data as any;
    if (typeof data.content !== 'string' || typeof data.sha !== 'string') return null;
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return { content, sha: data.sha };
  } catch {
    return null;
  }
}

async function createBranch(octokit: any, owner: string, repo: string, baseBranch: string, newBranch: string): Promise<void> {
  const baseRef = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  const sha = (baseRef.data as any)?.object?.sha;
  if (!sha) throw new Error(`Base branch ${baseBranch} SHA not found`);

  await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
    owner,
    repo,
    ref: `refs/heads/${newBranch}`,
    sha,
  });
}

function parseTrackingPlan(content: string): TrackingPlan {
  try {
    return JSON.parse(content) as TrackingPlan;
  } catch {
    return createEmptyPlan();
  }
}

function createEmptyPlan(): TrackingPlan {
  const now = new Date().toISOString();
  return {
    version: '1.0',
    generatedAt: now,
    generatedBy: 'logline-app',
    product: {
      mission: '',
      valueProposition: '',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    },
    events: [],
    context: {
      actors: [],
      objects: [],
      relationships: [],
      lifecycles: [],
      joinPaths: [],
      expectedSequences: [],
    },
    metrics: [],
    coverage: {
      tracked: 0,
      suggested: 0,
      approved: 0,
      implemented: 0,
      percentage: 0,
    },
  };
}

function buildSyncBody(implementedEvents: string[]): string {
  return [
    'This PR syncs `.logline/tracking-plan.json` statuses after merged instrumentation.',
    '',
    'Implemented events detected in merged code:',
    ...implementedEvents.map((event) => `- \`${event}\``),
  ].join('\n');
}

function recalcCoverage(plan: TrackingPlan): TrackingPlan['coverage'] {
  const suggested = plan.events.filter((e) => e.status === 'suggested').length;
  const approved = plan.events.filter((e) => e.status === 'approved').length;
  const implemented = plan.events.filter((e) => e.status === 'implemented').length;
  const tracked = implemented;
  const total = suggested + approved + implemented;
  const percentage = total > 0 ? Math.round((tracked / total) * 100) : 0;
  return { tracked, suggested, approved, implemented, percentage };
}

