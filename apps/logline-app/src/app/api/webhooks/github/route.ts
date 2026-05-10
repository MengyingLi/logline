import { NextRequest, NextResponse } from 'next/server';
import { Webhooks } from '@octokit/webhooks';
import { createHash } from 'node:crypto';
import { handleMergedPullRequest, handlePullRequest } from '@/lib/analysis/diff-analyzer';
import { handleReviewCommentFeedback } from '@/lib/feedback/webhook-feedback';
import { claimWebhookDelivery } from '@/lib/db';
import { logger } from '@/lib/logger';
import { apiJsonError } from '@/lib/api-error';
import { getOrCreateRequestId } from '@/lib/request-id';

const secret = process.env.GITHUB_WEBHOOK_SECRET;

const webhooks = secret ? new Webhooks({ secret }) : null;

export const maxDuration = 300;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(req);
  const log = logger.child({ requestId, route: 'webhooks/github' });

  if (!webhooks || !secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';
  const eventName = req.headers.get('x-github-event') ?? '';
  const deliveryIdHeader = req.headers.get('x-github-delivery') ?? '';
  const deliveryId =
    deliveryIdHeader ||
    `sha256:${createHash('sha256').update(body).digest('hex')}`;

  const isValid = await webhooks.verify(body, signature);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  try {
    const claimed = await claimWebhookDelivery(deliveryId, eventName);
    if (!claimed) {
      return NextResponse.json({ ok: true, duplicate: true });
    }
  } catch (err) {
    log.error({ err, deliveryId }, 'Webhook idempotency claim failed');
    return apiJsonError(
      'SERVICE_UNAVAILABLE',
      'Cannot verify webhook idempotency — retry later',
      503,
      requestId
    );
  }

  try {
    if (eventName === 'pull_request') {
      const prPayload = payload as {
        action?: string;
        installation?: { id?: number };
        repository?: { owner?: { login?: string }; name?: string };
        number?: number;
        pull_request?: {
          number?: number;
          merged?: boolean;
          head?: { ref?: string; sha?: string };
          base?: { ref?: string };
        };
      };
      const action = prPayload.action;
      if (action === 'opened' || action === 'synchronize') {
        await handlePullRequest(prPayload);
      }
      if (action === 'closed') {
        await handleMergedPullRequest(prPayload);
      }
    }

    if (eventName === 'pull_request_review_comment') {
      await handleReviewCommentFeedback(payload as never);
    }
  } catch (err) {
    log.error({ err }, 'Webhook handler failed');
    return apiJsonError('SERVICE_ERROR', 'Handler failed', 500, requestId);
  }

  return NextResponse.json({ ok: true });
}
