import { recordRejected } from './store';

interface ReviewCommentPayload {
  action?: string;
  repository?: { owner?: { login?: string }; name?: string };
  pull_request?: { number?: number };
  comment?: { body?: string; path?: string };
}

export function handleReviewCommentFeedback(payload: ReviewCommentPayload): void {
  const action = payload.action ?? '';
  if (action !== 'created' && action !== 'edited') return;

  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const prNumber = payload.pull_request?.number;
  const body = payload.comment?.body ?? '';
  const path = payload.comment?.path ?? 'unknown';
  if (!owner || !repo || !prNumber) return;

  const eventName = extractRejectedEventName(body);
  if (!eventName) return;

  recordRejected(`${owner}/${repo}`, {
    eventName,
    file: path,
    prNumber,
    reason: 'Rejected from review comment',
    timestamp: new Date().toISOString(),
  });
}

function extractRejectedEventName(body: string): string | null {
  const byTag = body.match(/logline\s*reject\s*:\s*([a-z0-9_]+)/i);
  if (byTag?.[1]) return byTag[1].toLowerCase();
  const byHeading = body.match(/Track\s+`([a-z0-9_]+)`/i);
  const hasThumbsDown = body.includes('👎') || body.toLowerCase().includes('thumbs down');
  if (byHeading?.[1] && hasThumbsDown) return byHeading[1].toLowerCase();
  return null;
}

