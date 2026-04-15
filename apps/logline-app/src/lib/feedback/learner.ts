import { getRepoFeedback } from './store';

export function shouldSuggestEvent(repoFullName: string, eventName: string): boolean {
  const feedback = getRepoFeedback(repoFullName);
  return !feedback.rejected.some((r) => r.eventName.toLowerCase() === eventName.toLowerCase());
}

export function confidenceBoost(repoFullName: string, eventName: string): number {
  const feedback = getRepoFeedback(repoFullName);
  const acceptedCount = feedback.accepted.filter((a) => a.eventName.toLowerCase() === eventName.toLowerCase()).length;
  if (acceptedCount >= 5) return 0.2;
  if (acceptedCount >= 2) return 0.1;
  return 0;
}

