import { NextRequest, NextResponse } from 'next/server';
import { resolveApiKey, insertEvent } from '@/lib/db';
import type { FanoutConfig } from '@/lib/db';

interface IngestBody {
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
  environment?: string;
}

/**
 * POST /api/v1/events/ingest
 *
 * Path A: stores the event in Supabase for the Logline dashboard.
 * Path B: fans out to any configured destinations (Segment, PostHog, Mixpanel, custom).
 *
 * Auth: Authorization: Bearer lk_<key>
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing Authorization header' }, { status: 401 });
  }

  const resolved = await resolveApiKey(apiKey).catch(() => null);
  if (!resolved) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }
  const { repoId, repo } = resolved;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.event || typeof body.event !== 'string') {
    return NextResponse.json({ error: 'Missing required field: event' }, { status: 400 });
  }

  const eventName = body.event.trim().toLowerCase();
  const properties = body.properties ?? null;
  const environment = body.environment ?? 'production';

  // ── Path A: store in Supabase ─────────────────────────────────────────────
  await insertEvent(repoId, eventName, properties, environment);

  // ── Path B: fan out to configured destinations ────────────────────────────
  const fanout = repo.fanout_config as FanoutConfig | null;
  if (fanout) {
    await Promise.allSettled([
      fanout.segment && fanoutSegment(fanout.segment, eventName, properties, body.timestamp),
      fanout.posthog && fanoutPostHog(fanout.posthog, eventName, properties, body.timestamp),
      fanout.mixpanel && fanoutMixpanel(fanout.mixpanel, eventName, properties, body.timestamp),
      fanout.amplitude && fanoutAmplitude(fanout.amplitude, eventName, properties, body.timestamp),
      fanout.custom && fanoutCustom(fanout.custom, eventName, properties, body.timestamp),
    ].filter(Boolean));
  }

  return NextResponse.json({ ok: true, event: eventName });
}

// ─── Fan-out implementations ──────────────────────────────────────────────────

async function fanoutSegment(
  config: NonNullable<FanoutConfig['segment']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  await fetch('https://api.segment.io/v1/track', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.writeKey}:`).toString('base64')}`,
    },
    body: JSON.stringify({
      type: 'track',
      event,
      properties: properties ?? {},
      timestamp: timestamp ?? new Date().toISOString(),
      messageId: crypto.randomUUID(),
    }),
  });
}

async function fanoutPostHog(
  config: NonNullable<FanoutConfig['posthog']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  const host = config.host ?? 'https://app.posthog.com';
  await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      event,
      properties: { ...(properties ?? {}), $lib: 'logline' },
      timestamp: timestamp ?? new Date().toISOString(),
    }),
  });
}

async function fanoutMixpanel(
  config: NonNullable<FanoutConfig['mixpanel']>,
  event: string,
  properties: Record<string, unknown> | null,
  _timestamp?: string
): Promise<void> {
  await fetch('https://api.mixpanel.com/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        event,
        properties: { token: config.token, ...(properties ?? {}) },
      },
    ]),
  });
}

async function fanoutAmplitude(
  config: NonNullable<FanoutConfig['amplitude']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  await fetch('https://api2.amplitude.com/2/httpapi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      events: [
        {
          event_type: event,
          event_properties: properties ?? {},
          time: timestamp ? new Date(timestamp).getTime() : Date.now(),
          insert_id: crypto.randomUUID(),
          user_id: (properties?.user_id as string) ?? 'anonymous',
        },
      ],
    }),
  });
}

async function fanoutCustom(
  config: NonNullable<FanoutConfig['custom']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  await fetch(config.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.headers ?? {}),
    },
    body: JSON.stringify({
      event,
      properties: properties ?? {},
      timestamp: timestamp ?? new Date().toISOString(),
    }),
  });
}
