import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';
import type { Convention, ConventionEvent } from './types';

const LIFECYCLES = ['attempt', 'success', 'fail', 'start', 'complete', 'skip'] as const;
const STATUSES = ['stable', 'experimental', 'deprecated'] as const;

/**
 * Resolve the conventions directory. When running from dist/cli.js, conventions
 * live at package root. When running via tsx from src/, we use package root.
 */
export function getConventionsDir(): string {
  const fromDist = path.join(__dirname, '..', '..', 'conventions');
  if (fs.existsSync(fromDist)) return fromDist;
  const fromCwd = path.join(process.cwd(), 'conventions');
  if (fs.existsSync(fromCwd)) return fromCwd;
  return fromDist;
}

function isConvention(raw: unknown): raw is Convention {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (typeof o.domain !== 'string' || typeof o.description !== 'string') return false;
  if (!STATUSES.includes(o.status as (typeof STATUSES)[number])) return false;
  if (typeof o.version !== 'string') return false;
  if (!Array.isArray(o.events)) return false;
  for (const ev of o.events) {
    if (!ev || typeof ev !== 'object') return false;
    const e = ev as Record<string, unknown>;
    if (typeof e.name !== 'string' || typeof e.description !== 'string') return false;
    if (!LIFECYCLES.includes(e.lifecycle as (typeof LIFECYCLES)[number])) return false;
    if (!e.attributes || typeof e.attributes !== 'object') return false;
    const a = e.attributes as Record<string, unknown>;
    if (!Array.isArray(a.required) || !Array.isArray(a.optional)) return false;
  }
  return true;
}

function normalizeConvention(raw: Record<string, unknown>): Convention {
  const events = (raw.events as Record<string, unknown>[]).map((ev) => {
    const attrs = ev.attributes as Record<string, unknown>;
    return {
      name: String(ev.name),
      lifecycle: ev.lifecycle as Convention['events'][0]['lifecycle'],
      description: String(ev.description),
      attributes: {
        required: (attrs.required as Record<string, unknown>[] || []).map(normalizeAttr),
        optional: (attrs.optional as Record<string, unknown>[] || []).map(normalizeAttr),
      },
    };
  });
  return {
    domain: String(raw.domain),
    description: String(raw.description),
    status: raw.status as Convention['status'],
    version: String(raw.version),
    events,
  };
}

function normalizeAttr(a: Record<string, unknown>): ConventionEvent['attributes']['required'][0] {
  const out: ConventionEvent['attributes']['required'][0] = {
    name: String(a.name),
    type: (a.type as ConventionEvent['attributes']['required'][0]['type']) ?? 'string',
    description: String(a.description ?? ''),
  };
  if (Array.isArray(a.values)) out.values = a.values.map(String);
  if (a.items != null) out.items = String(a.items);
  return out;
}

export interface LoadedConventions {
  byDomain: Map<string, Convention>;
  byEventName: Map<string, ConventionEvent>;
}

/**
 * Load all YAML convention files from the conventions directory.
 * Returns maps keyed by domain and by event name for fast lookup.
 */
export async function loadConventions(conventionsDir?: string): Promise<LoadedConventions> {
  const dir = conventionsDir ?? getConventionsDir();
  const byDomain = new Map<string, Convention>();
  const byEventName = new Map<string, ConventionEvent>();

  if (!fs.existsSync(dir)) {
    return { byDomain, byEventName };
  }

  const files = await glob('**/*.{yaml,yml}', { cwd: dir, absolute: true });
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const raw = yaml.load(content) as unknown;
      if (!isConvention(raw)) continue;
      const convention = normalizeConvention(raw as unknown as Record<string, unknown>);
      if (byDomain.has(convention.domain)) continue;
      byDomain.set(convention.domain, convention);
      for (const ev of convention.events) {
        byEventName.set(ev.name, ev);
      }
    } catch {
      // Skip invalid or unreadable files
    }
  }

  return { byDomain, byEventName };
}
