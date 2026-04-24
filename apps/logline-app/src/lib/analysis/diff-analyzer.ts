import {
  detectInteractions,
  synthesizeEvents,
  type FileContent,
  type RawInteraction,
  type ProductProfile,
} from 'logline-cli';
import { getInstallationOctokit } from '@/lib/github';
import { parsePRDiff } from './diff-parser';
import { postReview } from '@/lib/comments/review-builder';
import { checkEntitlement } from '@/lib/billing/entitlements';
import { shouldSuggestEvent } from '@/lib/feedback/learner';
import { syncTrackingPlan } from '@/lib/tracking-plan-sync';
import type { DiffFile } from '@/types';

interface PullRequestPayload {
  installation?: { id?: number };
  repository?: { owner?: { login?: string }; name?: string };
  number?: number;
  pull_request?: { number?: number; head?: { ref?: string; sha?: string }; base?: { ref?: string }; merged?: boolean };
}

const analyzedHeadShas = new Set<string>();

export async function handlePullRequest(payload: PullRequestPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = payload.pull_request?.number ?? payload.number;
  const branch = payload.pull_request?.head?.ref;
  const headSha = payload.pull_request?.head?.sha;

  if (!installationId || !owner || !repo || !prNumber) return;
  const repoFullName = `${owner}/${repo}`;
  if (headSha) {
    const dedupeKey = `${repoFullName}#${prNumber}#${headSha}`;
    if (analyzedHeadShas.has(dedupeKey)) return;
    analyzedHeadShas.add(dedupeKey);
  }

  const entitled = await checkEntitlement(installationId, repoFullName);
  if (!entitled) return;

  const octokit = await getInstallationOctokit(installationId);
  const { files, diffs } = await parsePRDiff(octokit, owner, repo, prNumber, branch);
  const interactions = detectInteractions(files as FileContent[]);
  const newInteractions = filterToNewLines(interactions, diffs);
  if (newInteractions.length === 0) return;

  const profile: ProductProfile = {
    mission: 'Unknown product',
    valueProposition: 'Unknown',
    businessGoals: [],
    userPersonas: [],
    keyMetrics: [],
    confidence: 0,
  };

  const events = await synthesizeEvents(newInteractions, profile, {
    fast: !process.env.OPENAI_API_KEY,
    apiKey: process.env.OPENAI_API_KEY,
    files: files as FileContent[],
  });
  const filteredEvents = events
    .filter((event) => shouldSuggestEvent(repoFullName, event.name))
    .slice(0, 20);
  if (filteredEvents.length === 0) return;

  console.log('[logline-app] events to post:', filteredEvents.map((e) => ({
    name: e.name,
    file: e.location.file,
    line: e.location.line,
    properties: e.properties,
  })));

  await postReview(octokit as any, owner, repo, prNumber, filteredEvents, diffs);
}

export function filterToNewLines(interactions: RawInteraction[], diffs: DiffFile[]): RawInteraction[] {
  return interactions.filter((interaction) => {
    const diff = diffs.find((d) => d.path === interaction.file);
    if (!diff) return false;
    return diff.addedLines.includes(interaction.line);
  });
}

export async function handleMergedPullRequest(payload: PullRequestPayload): Promise<void> {
  if (!payload.pull_request?.merged) return;
  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = payload.pull_request?.number ?? payload.number;
  const baseBranch = payload.pull_request?.base?.ref ?? 'main';
  if (!installationId || !owner || !repo || !prNumber) return;
  const octokit = await getInstallationOctokit(installationId);
  const implementedEvents = await detectImplementedEventsInPR(octokit as any, owner, repo, prNumber);
  await syncTrackingPlan({
    octokit,
    owner,
    repo,
    baseBranch,
    implementedEvents,
  });
}

async function detectImplementedEventsInPR(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number
): Promise<string[]> {
  const found = new Set<string>();
  let page = 1;
  while (page <= 10) {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    for (const file of res.data as Array<{ patch?: string }>) {
      const patch = file.patch ?? '';
      for (const line of patch.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const m = line.match(/\/\/\s*Logline:\s*([a-z0-9_]+)/i);
        if (m?.[1]) found.add(m[1].toLowerCase());
      }
    }
    if (res.data.length < 100) break;
    page += 1;
  }
  return Array.from(found);
}

