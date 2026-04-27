/**
 * Logline SDK — minimal track() function that batches and ships events
 * to the Logline Cloud ingest endpoint (or any compatible endpoint).
 *
 * Works in browsers, Node.js, and edge runtimes. Zero dependencies.
 *
 * Usage:
 *   import { init, track } from 'logline-cli/sdk';
 *   init({ apiKey: 'lk_...' });
 *   track('workflow_created', { workflow_id });
 */

export interface LoglineConfig {
  /** lk_xxx key from the Logline dashboard */
  apiKey: string;
  /** Defaults to https://logline.dev/api/v1/events/ingest */
  endpoint?: string;
  /** Defaults to process.env.NODE_ENV || 'production' */
  environment?: string;
  /** Flush interval in ms. Default 5000. */
  flushInterval?: number;
  /** Max events per flush. Default 20. */
  maxBatchSize?: number;
  /** Log every track() call to the console. */
  debug?: boolean;
}

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

let config: LoglineConfig | null = null;
let queue: QueuedEvent[] = [];
let timer: ReturnType<typeof setInterval> | null = null;

export function init(options: LoglineConfig): void {
  config = {
    endpoint: 'https://logline.dev/api/v1/events/ingest',
    environment:
      typeof process !== 'undefined' ? (process.env?.NODE_ENV ?? 'production') : 'production',
    flushInterval: 5000,
    maxBatchSize: 20,
    ...options,
  };

  if (timer) clearInterval(timer);
  timer = setInterval(flush, config.flushInterval);

  // Flush on page unload in browser environments
  if (typeof globalThis !== 'undefined' && typeof (globalThis as { addEventListener?: unknown }).addEventListener === 'function') {
    (globalThis as { addEventListener: (event: string, fn: () => void) => void }).addEventListener('beforeunload', flush);
  }
}

export function track(event: string, properties: Record<string, unknown> = {}): void {
  if (!config) {
    console.warn('[logline] track() called before init(). Call logline.init({ apiKey: "lk_..." }) first.');
    return;
  }
  queue.push({ event, properties, timestamp: new Date().toISOString() });
  if (config.debug) console.log(`[logline] track: ${event}`, properties);
  if (queue.length >= (config.maxBatchSize ?? 20)) flush();
}

export function flush(): void {
  if (!config || queue.length === 0) return;
  const batch = queue.splice(0);
  const { endpoint, apiKey, environment } = config as Required<LoglineConfig>;

  for (const item of batch) {
    fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        event: item.event,
        properties: item.properties,
        environment,
        timestamp: item.timestamp,
      }),
      keepalive: true,
    }).catch(() => {}); // silently drop on network error — never block the app
  }
}

/** Stop the flush timer and send any remaining events. Call on server shutdown. */
export function shutdown(): void {
  if (timer) { clearInterval(timer); timer = null; }
  flush();
}
