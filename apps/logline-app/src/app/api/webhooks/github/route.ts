import { NextRequest, NextResponse } from 'next/server';
import { Webhooks } from '@octokit/webhooks';
import { handleMergedPullRequest, handlePullRequest } from '@/lib/analysis/diff-analyzer';
import { handleReviewCommentFeedback } from '@/lib/feedback/webhook-feedback';

const secret = process.env.GITHUB_WEBHOOK_SECRET;

const webhooks = secret ? new Webhooks({ secret }) : null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!webhooks || !secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  const event = req.headers.get('x-github-event') ?? '';

  const isValid = await webhooks.verify(body, signature);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const payload = JSON.parse(body);
  if (event === 'pull_request') {
    const action = payload?.action;
    if (action === 'opened' || action === 'synchronize') {
      handlePullRequest(payload).catch((err) => {
        console.error('[logline-app] pull_request handling failed', err);
      });
    }
    if (action === 'closed') {
      handleMergedPullRequest(payload).catch((err) => {
        console.error('[logline-app] merged pull_request handling failed', err);
      });
    }
  }

  if (event === 'pull_request_review_comment') {
    try {
      handleReviewCommentFeedback(payload);
    } catch (err) {
      console.error('[logline-app] review comment feedback handling failed', err);
    }
  }

  return NextResponse.json({ ok: true });
}

