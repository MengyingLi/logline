import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { TrackingPlan, TrackingPlanEvent, CoverageStats, ProductProfile, TrackingPlanContext } from '../types';

const TRACKING_PLAN_FILENAME = 'tracking-plan.json';
const TRACKING_PLAN_DIR = '.logline';
const CURRENT_VERSION = '1.0';

/**
 * Generate a stable event ID from the event name.
 * Same name always produces same ID, so re-running spec doesn't create duplicates.
 */
export function generateEventId(eventName: string): string {
  const hash = crypto.createHash('sha256').update(eventName).digest('hex').slice(0, 8);
  return `evt_${hash}`;
}

/**
 * Get the path to tracking-plan.json for a given project directory.
 */
export function getTrackingPlanPath(cwd: string): string {
  return path.join(cwd, TRACKING_PLAN_DIR, TRACKING_PLAN_FILENAME);
}

/**
 * Read existing tracking plan from disk. Returns null if it doesn't exist.
 */
export function readTrackingPlan(cwd: string): TrackingPlan | null {
  const planPath = getTrackingPlanPath(cwd);
  if (!fs.existsSync(planPath)) return null;
  try {
    const raw = fs.readFileSync(planPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.version || !Array.isArray(parsed.events)) return null;
    return parsed as TrackingPlan;
  } catch {
    return null;
  }
}

/**
 * Write tracking plan to disk.
 */
export function writeTrackingPlan(cwd: string, plan: TrackingPlan): void {
  const planPath = getTrackingPlanPath(cwd);
  fs.mkdirSync(path.dirname(planPath), { recursive: true });
  fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));
}

/**
 * Merge new scan results into an existing tracking plan.
 *
 * Rules:
 * - New events (not in existing plan) → added with their given status
 * - Existing events with status "suggested" → update description, locations, properties, priority, lastSeen
 * - Existing events with status "approved" → only update locations and lastSeen
 * - Existing events with status "implemented" → only update lastSeen
 * - Existing events with status "deprecated" → leave untouched
 * - Events in old plan but NOT in new scan → keep them (don't delete), don't update lastSeen
 */
export function mergeTrackingPlan(
  existing: TrackingPlan | null,
  newEvents: TrackingPlanEvent[],
  product: ProductProfile,
  coverage: CoverageStats,
  context?: TrackingPlanContext
): TrackingPlan {
  const now = new Date().toISOString();

  if (!existing) {
    return {
      version: CURRENT_VERSION,
      generatedAt: now,
      generatedBy: `logline@${getVersion()}`,
      product,
      events: newEvents,
      context,
      coverage,
    };
  }

  const existingById = new Map<string, TrackingPlanEvent>();
  for (const e of existing.events) {
    existingById.set(e.id, e);
  }

  const newById = new Map<string, TrackingPlanEvent>();
  for (const e of newEvents) {
    newById.set(e.id, e);
  }

  const merged = new Map<string, TrackingPlanEvent>();

  // Process existing events: apply merge rules
  for (const existingEvent of existing.events) {
    const newEvent = newById.get(existingEvent.id);
    if (!newEvent) {
      // Not in new scan — keep as-is, don't update lastSeen
      merged.set(existingEvent.id, existingEvent);
      continue;
    }

    switch (existingEvent.status) {
      case 'suggested':
        // Update everything except firstSeen
        merged.set(existingEvent.id, {
          ...newEvent,
          status: 'suggested',
          firstSeen: existingEvent.firstSeen,
          lastSeen: now,
        });
        break;
      case 'approved':
        // Only update locations and lastSeen
        merged.set(existingEvent.id, {
          ...existingEvent,
          locations: newEvent.locations,
          lastSeen: now,
        });
        break;
      case 'implemented':
        // Only update lastSeen
        merged.set(existingEvent.id, {
          ...existingEvent,
          lastSeen: now,
        });
        break;
      case 'deprecated':
        // Leave untouched
        merged.set(existingEvent.id, existingEvent);
        break;
    }
  }

  // Add new events not previously in the plan
  for (const newEvent of newEvents) {
    if (!merged.has(newEvent.id)) {
      merged.set(newEvent.id, newEvent);
    }
  }

  return {
    ...existing,
    generatedAt: now,
    generatedBy: `logline@${getVersion()}`,
    product,
    events: Array.from(merged.values()),
    context: context ?? existing.context,
    coverage,
  };
}

/**
 * Create an empty tracking plan (used by `logline init`).
 */
export function createEmptyTrackingPlan(product?: ProductProfile): TrackingPlan {
  return {
    version: CURRENT_VERSION,
    generatedAt: new Date().toISOString(),
    generatedBy: `logline@${getVersion()}`,
    product: product ?? {
      mission: '',
      valueProposition: '',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    },
    events: [],
    coverage: { tracked: 0, suggested: 0, approved: 0, implemented: 0, percentage: 0 },
  };
}

function getVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}
