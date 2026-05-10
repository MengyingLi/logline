import type { AcceptedEvent, RejectedEvent, RepoFeedback } from './types';
import { getFeedbackPayloadForRepo, getRepo, mergeFeedbackPayload } from '@/lib/db';

export type { AcceptedEvent, RejectedEvent, RepoFeedback };

/** Resolve repo id from `owner/name` full name. */
async function resolveRepoId(repoFullName: string): Promise<number | null> {
  const idx = repoFullName.indexOf('/');
  if (idx === -1) return null;
  const owner = repoFullName.slice(0, idx);
  const name = repoFullName.slice(idx + 1);
  const repo = await getRepo(owner, name).catch(() => null);
  return repo?.id ?? null;
}

export async function getRepoFeedback(repoFullName: string): Promise<RepoFeedback> {
  const repoId = await resolveRepoId(repoFullName);
  if (!repoId) {
    return { repoFullName, accepted: [], rejected: [] };
  }
  const payload = await getFeedbackPayloadForRepo(repoId);
  return {
    repoFullName,
    accepted: payload.accepted as AcceptedEvent[],
    rejected: payload.rejected as RejectedEvent[],
  };
}

export async function recordAccepted(repoFullName: string, accepted: AcceptedEvent): Promise<void> {
  const repoId = await resolveRepoId(repoFullName);
  if (!repoId) return;
  await mergeFeedbackPayload(repoId, (prev) => ({
    ...prev,
    accepted: [...prev.accepted, accepted],
  }));
}

export async function recordRejected(repoFullName: string, rejected: RejectedEvent): Promise<void> {
  const repoId = await resolveRepoId(repoFullName);
  if (!repoId) return;
  await mergeFeedbackPayload(repoId, (prev) => ({
    ...prev,
    rejected: [...prev.rejected, rejected],
  }));
}
