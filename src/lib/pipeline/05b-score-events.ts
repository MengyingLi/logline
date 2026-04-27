import type { SynthesizedEvent } from './types';
import type { TrackingPlanContext, FileContent } from '../types';

export interface ScoredEvent extends SynthesizedEvent {
  relevanceScore: number;
  scoreBreakdown: {
    schemaMatch: number;      // 0-0.3: entity exists in DB/schema context
    fileRelevance: number;    // 0-0.2: file is user-facing vs internal
    crossReference: number;  // 0-0.2: entity appears in multiple files
    entityQuality: number;   // 0-0.15: entity name looks like a business object
    interactionType: number; // 0-0.15: how the interaction was detected
  };
}

// ─── Well-known business entity names ────────────────────────────────────────

const BUSINESS_ENTITY_PATTERNS = new Set([
  'user', 'project', 'order', 'payment', 'invoice', 'team', 'comment',
  'workspace', 'organization', 'member', 'subscription', 'issue', 'task',
  'ticket', 'document', 'report', 'dashboard', 'chart', 'message', 'thread',
  'post', 'article', 'video', 'image', 'workflow', 'pipeline', 'campaign',
  'customer', 'account', 'lead', 'contact', 'deal', 'opportunity', 'product',
  'item', 'cart', 'checkout', 'transaction', 'link', 'form', 'survey',
  'response', 'notification', 'alert', 'plan', 'tier', 'feature',
  'integration', 'connection', 'domain', 'environment', 'deployment',
  'build', 'release', 'version', 'review', 'approval', 'policy', 'rule',
  'automation', 'schedule', 'export', 'import', 'invite', 'setting',
  'upload', 'download', 'file', 'folder', 'channel', 'conversation', 'room',
  'event', 'session', 'booking', 'appointment', 'reservation', 'listing',
  'profile', 'avatar', 'asset', 'collection', 'playlist', 'package',
]);

// Infrastructure entities whose CRUD calls are rarely user-facing analytics
const INFRASTRUCTURE_ENTITIES = new Set([
  'token', 'cookie', 'query', 'param', 'header',
  'listener', 'observer', 'handler', 'middleware', 'interceptor',
  'timer', 'interval', 'timeout', 'socket',
  'log', 'metric', 'span', 'trace',
  'stream', 'buffer', 'lock', 'mutex', 'semaphore', 'cache',
  'ref', 'effect', 'provider', 'store', 'state',
  'map', 'set', 'array', 'object',
]);

// ─── Public API ───────────────────────────────────────────────────────────────

export function scoreEvents(
  events: SynthesizedEvent[],
  context: TrackingPlanContext,
  files: FileContent[]
): ScoredEvent[] {
  // Pre-build a cross-reference index: entity → file count
  const xrefCache = new Map<string, number>();

  return events.map((event) => {
    const entity = extractEntity(event.name);
    const breakdown = {
      schemaMatch: scoreSchemaMatch(entity, context),
      fileRelevance: scoreFileRelevance(event.location?.file ?? ''),
      crossReference: scoreCrossReference(entity, files, xrefCache),
      entityQuality: scoreEntityQuality(entity),
      interactionType: scoreInteractionType(event),
    };
    const relevanceScore = Math.min(
      1,
      breakdown.schemaMatch +
        breakdown.fileRelevance +
        breakdown.crossReference +
        breakdown.entityQuality +
        breakdown.interactionType
    );
    return { ...event, relevanceScore, scoreBreakdown: breakdown };
  });
}

// ─── Signal functions ─────────────────────────────────────────────────────────

/** Extract the object part of an event name (everything before the last verb). */
function extractEntity(eventName: string): string {
  const parts = eventName.split('_').filter(Boolean);
  if (parts.length < 2) return eventName;
  return parts.slice(0, -1).join('_');
}

/**
 * schemaMatch (max 0.3): Does the entity correspond to a known business object
 * detected from the codebase's schema (Prisma, SQL, Supabase, TypeScript types)?
 */
function scoreSchemaMatch(entity: string, context: TrackingPlanContext): number {
  if (!context?.objects?.length) return 0;
  const entityNorm = entity.toLowerCase().replace(/_/g, '');
  for (const obj of context.objects) {
    const objNorm = obj.name.toLowerCase().replace(/_/g, '');
    if (objNorm === entityNorm) return 0.3;
    // Partial match: "team_invite" vs "TeamInvite", or "workspace_member" vs "Member"
    if (
      objNorm.length >= 3 &&
      entityNorm.length >= 3 &&
      (objNorm.includes(entityNorm) || entityNorm.includes(objNorm))
    ) {
      return 0.2;
    }
  }
  return 0;
}

/**
 * fileRelevance (max 0.2): Where in the codebase was this interaction found?
 * UI components and pages are the most reliable signal; scripts and cron jobs are noise.
 */
function scoreFileRelevance(file: string): number {
  const f = file.toLowerCase();

  // Definite noise paths
  if (
    /\/(scripts?|migrations?|seeds?|e2e|cypress|playwright|__tests__|__mocks__|fixtures|test.utils|\.test\.|\.spec\.)\//i.test(
      f
    )
  )
    return 0;
  if (/\/(cron|jobs?|workers?|queues?|tasks?|scheduler)\//i.test(f)) return 0;

  // UI — highest confidence
  if (/\/(components?|pages?|views?|screens?|features?|ui)\//i.test(f)) return 0.2;
  if (/\/app\/.*\.(tsx|jsx)$/.test(f)) return 0.2; // Next.js App Router

  // API route handlers
  if (/\/(api|routes?)\//i.test(f)) return 0.18;

  // React hooks
  if (/\/hooks?\//i.test(f) || /\/use[A-Z]/.test(file)) return 0.15;

  // Server actions (Next.js 13+, Remix)
  if (/\/actions?\//i.test(f)) return 0.15;

  // lib/ sub-paths with action semantics
  if (/\/lib\/.*actions?/i.test(f)) return 0.12;

  // Generic lib / utils
  if (/\/(lib|utils?|helpers?|services?)\//i.test(f)) return 0.08;

  // Incoming webhooks — server-side only, low user signal
  if (/\/webhooks?\//i.test(f)) return 0.02;

  // Unclassified: moderate confidence
  return 0.1;
}

/**
 * crossReference (max 0.2): How many files in the codebase mention this entity?
 * Core business objects appear in many files; internal utilities appear in few.
 */
function scoreCrossReference(
  entity: string,
  files: FileContent[],
  cache: Map<string, number>
): number {
  if (!entity || files.length === 0) return 0.03;

  const cacheKey = entity.toLowerCase();
  let fileCount = cache.get(cacheKey);
  if (fileCount === undefined) {
    // Match whole-word occurrences (including camelCase variants like "teamInvite")
    const reExact = new RegExp(`\\b${escapeRegex(entity)}\\b`, 'i');
    const entityCamel = entity.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    const reCamel = entityCamel !== entity ? new RegExp(`\\b${escapeRegex(entityCamel)}\\b`) : null;
    fileCount = 0;
    for (const file of files) {
      if (reExact.test(file.content) || reCamel?.test(file.content)) {
        fileCount++;
      }
    }
    cache.set(cacheKey, fileCount);
  }

  if (fileCount >= 10) return 0.2;
  if (fileCount >= 5) return 0.15;
  if (fileCount >= 2) return 0.1;
  if (fileCount >= 1) return 0.03;
  return 0;
}

/**
 * entityQuality (max 0.15): Does the entity name look like a business domain object?
 * Infrastructure terms (token, cache, handler…) score nearly zero.
 */
function scoreEntityQuality(entity: string): number {
  if (!entity) return 0;

  const parts = entity.split('_').filter(Boolean);
  const bare = entity.replace(/_/g, '').toLowerCase();

  if (bare.length <= 2) return 0;

  // Every part is an infrastructure term → very low relevance
  if (parts.length > 0 && parts.every((p) => INFRASTRUCTURE_ENTITIES.has(p.toLowerCase()))) return 0.02;

  // Any part matches a known business entity → high quality
  if (parts.some((p) => BUSINESS_ENTITY_PATTERNS.has(p.toLowerCase()))) return 0.15;

  // Compound entity (multi-word) — likely domain-specific and intentional
  if (entity.includes('_')) return 0.1;

  // Single word with reasonable length
  if (bare.length >= 5) return 0.1;
  if (bare.length >= 3) return 0.08;

  return 0.05;
}

/**
 * interactionType (max 0.15): How was this interaction detected?
 * Form submits and named click handlers are stronger signals than generic CRUD calls.
 */
function scoreInteractionType(event: SynthesizedEvent): number {
  const hint = event.location?.hint ?? '';
  const file = event.location?.file ?? '';

  // Explicit form submission — strongest UI signal
  if (/\bonSubmit\b/i.test(hint)) return 0.15;

  // Named onClick handler (handleFoo) — intentional handler, not inline
  if (/\bonClick\b/i.test(hint) && /handle[A-Z]/.test(hint)) return 0.12;

  // React Query / TanStack useMutation
  if (/\buseMutation\b/.test(hint)) return 0.12;

  // Next.js / Express write route (POST/PUT/PATCH/DELETE)
  if (
    /\bexport\s+function\s+(POST|PUT|PATCH|DELETE)\b/.test(hint) ||
    /\b(post|put|patch|delete)\s*\(\s*['"`]/.test(hint)
  )
    return 0.1;

  // ORM/DB CRUD call — confidence depends on where it lives
  if (/\.(create|insert|update|delete|upsert|remove)\s*\(/.test(hint)) {
    return /\/(lib|utils?|helpers?)\//i.test(file) ? 0.08 : 0.1;
  }

  // Inline or anonymous onClick — weaker signal
  if (/\bonClick\b/i.test(hint)) return 0.05;

  // onChange / onToggle — UI state, low relevance
  if (/\bon(Change|Toggle)\b/i.test(hint)) return 0.03;

  return 0.05; // default
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
