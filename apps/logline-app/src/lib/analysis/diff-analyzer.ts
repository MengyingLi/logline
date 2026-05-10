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
import { tryAcquirePrAnalysisDedupe } from '@/lib/db';
import { logger } from '@/lib/logger';

interface PullRequestPayload {
  installation?: { id?: number };
  repository?: { owner?: { login?: string }; name?: string };
  number?: number;
  pull_request?: {
    number?: number;
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
    merged?: boolean;
  };
}

export async function handlePullRequest(payload: PullRequestPayload): Promise<void> {
  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = payload.pull_request?.number ?? payload.number;
  const headSha = payload.pull_request?.head?.sha;

  if (!installationId || !owner || !repo || !prNumber || !headSha) return;
  const repoFullName = `${owner}/${repo}`;

  const acquired = await tryAcquirePrAnalysisDedupe(installationId, repoFullName, prNumber, headSha);
  if (!acquired) return;

  const entitled = await checkEntitlement(installationId, repoFullName);
  if (!entitled) return;

  const octokit = await getInstallationOctokit(installationId);
  const { files, diffs } = await parsePRDiff(octokit, owner, repo, prNumber, headSha);
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

  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  if (!openaiConfigured) {
    logger.warn({ repo: repoFullName, pr: prNumber }, 'OPENAI_API_KEY missing — using fast synthesis path');
  }

  const events = await synthesizeEvents(newInteractions, profile, {
    fast: !process.env.OPENAI_API_KEY,
    apiKey: process.env.OPENAI_API_KEY,
    files: files as FileContent[],
  });

  const filteredEvents: typeof events = [];
  for (const event of events) {
    if (await shouldSuggestEvent(repoFullName, event.name)) {
      filteredEvents.push(event);
    }
  }
  const capped = filteredEvents.slice(0, 20);
  if (capped.length === 0) return;

  await postReview(octokit as Parameters<typeof postReview>[0], owner, repo, prNumber, capped, diffs, headSha);
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
  const implementedEvents = await detectImplementedEventsInPR(octokit as never, owner, repo, prNumber);
  await syncTrackingPlan({
    octokit,
    owner,
    repo,
    baseBranch,
    implementedEvents,
    installationId,
  });
}

async function detectImplementedEventsInPR(
  octokit: { request: (route: string, params: Record<string, unknown>) => Promise<{ data: unknown }> },
  owner: string,
  repo: string,
  prNumber: number
): Promise<string[]> {
  const found = new Set<string>();
  let page = 1;
  while (page <= 50) {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    const files = res.data as Array<{ patch?: string }>;
    for (const file of files) {
      const patch = file.patch ?? '';
      for (const line of patch.split('\n')) {
        if (!line.startsWith('+') || line.startsWith('+++')) continue;
        const m = line.match(/\/\/\s*Logline:\s*([a-z0-9_]+)/i);
        if (m?.[1]) found.add(m[1].toLowerCase());
      }
    }
    if (files.length < 100) break;
    page += 1;
  }
  return Array.from(found);
}
