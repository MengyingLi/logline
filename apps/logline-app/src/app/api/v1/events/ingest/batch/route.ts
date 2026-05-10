import { NextRequest, NextResponse } from 'next/server';
import type { Logger } from 'pino';
import { resolveApiKey, insertEvent } from '@/lib/db';
import type { FanoutConfig } from '@/lib/db';
import { logger } from '@/lib/logger';
import { BatchIngestBodySchema } from '@/lib/validation/schemas';
import { getOrCreateRequestId } from '@/lib/request-id';

const MAX_BODY_BYTES = 256 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 1000;
const rateBuckets = new Map<string, number[]>();

function allowRateLimit(keyId: string, count: number): boolean {
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;
  let stamps = rateBuckets.get(keyId);
  if (!stamps) {
    stamps = [];
    rateBuckets.set(keyId, stamps);
  }
  while (stamps.length && stamps[0]! < windowStart) {
    stamps.shift();
  }
  if (stamps.length + count > RATE_MAX) return false;
  for (let i = 0; i < count; i++) {
    stamps.push(now);
  }
  return true;
}

function isAllowedCustomFanoutUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const allow = process.env.FANOUT_CUSTOM_URL_ALLOWLIST;
    if (!allow) return u.protocol === 'https:';
    const hosts = allow.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
    return hosts.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function jsonWithRequestId(requestId: string, body: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(body, init);
  res.headers.set('x-request-id', requestId);
  return res;
}

/**
 * POST /api/v1/events/ingest/batch
 *
 * Auth: Authorization: Bearer lk_<key>
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = getOrCreateRequestId(req);
  const log = logger.child({ requestId, route: 'events/ingest/batch' });

  const authHeader = req.headers.get('authorization') ?? '';
  const apiKey = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!apiKey) {
    return jsonWithRequestId(requestId, { error: 'Missing Authorization header' }, { status: 401 });
  }

  const resolved = await resolveApiKey(apiKey).catch(() => null);
  if (!resolved) {
    return jsonWithRequestId(requestId, { error: 'Invalid or revoked API key' }, { status: 401 });
  }

  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) {
    return jsonWithRequestId(requestId, { error: 'Payload too large' }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    return jsonWithRequestId(requestId, { error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BatchIngestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonWithRequestId(
      requestId,
      { error: 'Invalid body', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { events } = parsed.data;

  const keyRateId = `k:${resolved.repoId}`;
  if (!allowRateLimit(keyRateId, events.length)) {
    return jsonWithRequestId(requestId, { error: 'Rate limit exceeded' }, { status: 429 });
  }

  const fanout = resolved.repo.fanout_config as FanoutConfig | null;

  const results = await Promise.allSettled(
    events.map(async (item) => {
      const eventName = item.event.trim().toLowerCase();
      const properties = item.properties ?? null;
      const environment = item.environment ?? 'production';

      await insertEvent(resolved.repoId, eventName, properties, environment);

      if (fanout) {
        if (fanout.custom?.url && !isAllowedCustomFanoutUrl(fanout.custom.url)) {
          log.warn({ url: fanout.custom.url }, 'blocked custom fanout URL (allowlist)');
        } else {
          await Promise.allSettled([
            fanout.segment && fanoutSegment(log, fanout.segment, eventName, properties, item.timestamp),
            fanout.posthog && fanoutPostHog(log, fanout.posthog, eventName, properties, item.timestamp),
            fanout.mixpanel && fanoutMixpanel(log, fanout.mixpanel, eventName, properties, item.timestamp),
            fanout.amplitude && fanoutAmplitude(log, fanout.amplitude, eventName, properties, item.timestamp),
            fanout.custom &&
              isAllowedCustomFanoutUrl(fanout.custom.url) &&
              fanoutCustom(log, fanout.custom, eventName, properties, item.timestamp),
          ].filter(Boolean));
        }
      }
    })
  );

  const accepted = results.filter((r) => r.status === 'fulfilled').length;
  const failed = results.filter((r) => r.status === 'rejected').length;

  return jsonWithRequestId(requestId, { ok: true, accepted, failed });
}

type FanoutLogger = Logger;

async function fanoutSegment(
  log: FanoutLogger,
  config: NonNullable<FanoutConfig['segment']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  const res = await fetch('https://api.segment.io/v1/track', {
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
  if (!res.ok) {
    log.warn({ destination: 'segment', status: res.status }, 'fanout failed');
  }
}

async function fanoutPostHog(
  log: FanoutLogger,
  config: NonNullable<FanoutConfig['posthog']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  const host = config.host ?? 'https://app.posthog.com';
  const res = await fetch(`${host}/capture/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      event,
      properties: { ...(properties ?? {}), $lib: 'logline' },
      timestamp: timestamp ?? new Date().toISOString(),
    }),
  });
  if (!res.ok) {
    log.warn({ destination: 'posthog', status: res.status }, 'fanout failed');
  }
}

async function fanoutMixpanel(
  log: FanoutLogger,
  config: NonNullable<FanoutConfig['mixpanel']>,
  event: string,
  properties: Record<string, unknown> | null,
  _timestamp?: string
): Promise<void> {
  const res = await fetch('https://api.mixpanel.com/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        event,
        properties: { token: config.token, ...(properties ?? {}) },
      },
    ]),
  });
  if (!res.ok) {
    log.warn({ destination: 'mixpanel', status: res.status }, 'fanout failed');
  }
}

async function fanoutAmplitude(
  log: FanoutLogger,
  config: NonNullable<FanoutConfig['amplitude']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  const res = await fetch('https://api2.amplitude.com/2/httpapi', {
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
  if (!res.ok) {
    log.warn({ destination: 'amplitude', status: res.status }, 'fanout failed');
  }
}

async function fanoutCustom(
  log: FanoutLogger,
  config: NonNullable<FanoutConfig['custom']>,
  event: string,
  properties: Record<string, unknown> | null,
  timestamp?: string
): Promise<void> {
  const res = await fetch(config.url, {
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
  if (!res.ok) {
    log.warn({ destination: 'custom', status: res.status, url: config.url }, 'fanout failed');
  }
}
