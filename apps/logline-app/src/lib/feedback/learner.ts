import { getRepoFeedback } from './store';

export async function shouldSuggestEvent(repoFullName: string, eventName: string): Promise<boolean> {
  const feedback = await getRepoFeedback(repoFullName);
  return !feedback.rejected.some((r) => r.eventName.toLowerCase() === eventName.toLowerCase());
}

export async function confidenceBoost(repoFullName: string, eventName: string): Promise<number> {
  const feedback = await getRepoFeedback(repoFullName);
  const acceptedCount = feedback.accepted.filter((a) => a.eventName.toLowerCase() === eventName.toLowerCase()).length;
  if (acceptedCount >= 5) return 0.2;
  if (acceptedCount >= 2) return 0.1;
  return 0;
}

