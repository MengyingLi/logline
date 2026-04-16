import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { scanCommand } from './scan';
import type { TrackingPlanEvent, EventProperty, CoverageStats, TrackingPlanContext, ObjectToObjectRelationship, JoinPath } from '../lib/types';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';
import { generateExpectedSequences } from '../lib/context/expected-sequence';
import {
  generateEventId,
  getTrackingPlanPath,
  readTrackingPlan,
  writeTrackingPlan,
  mergeTrackingPlan,
} from '../lib/utils/tracking-plan';

// Local property type — inferProperties uses 'array' which isn't in EventProperty
interface PropertySpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  todo?: boolean;
}

export async function specCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Clean up old per-event spec files if they exist
  const oldSpecsDir = path.join(cwd, '.logline', 'specs');
  if (fs.existsSync(oldSpecsDir)) {
    fs.rmSync(oldSpecsDir, { recursive: true, force: true });
  }

  const scanResult = await scanCommand({
    cwd,
    fast: !process.env.OPENAI_API_KEY,
  });
  const now = new Date().toISOString();

  // Convert gaps → TrackingPlanEvent[] with status 'suggested'
  const suggestedEvents: TrackingPlanEvent[] = scanResult.gaps.map((gap) =>
    gapToEvent(gap, now, scanResult.context)
  );

  // Convert detected events → TrackingPlanEvent[] with status 'implemented'
  const implementedEvents: TrackingPlanEvent[] = scanResult.events.map((ev) => ({
    id: generateEventId(ev.name),
    name: ev.name,
    description: `Tracked event: ${ev.name}`,
    actor: 'Unknown',
    object: 'Unknown',
    action: 'unknown',
    properties: (ev.properties ?? []).map((p) => ({
      name: p,
      type: 'string' as const,
      required: false,
    })),
    locations: ev.locations,
    priority: 'medium' as const,
    status: 'implemented' as const,
    signalType: 'action' as const,
    firstSeen: now,
    lastSeen: now,
  }));

  const newEvents: TrackingPlanEvent[] = [...suggestedEvents, ...implementedEvents];

  // Compute coverage stats from new events
  const coverage: CoverageStats = computeCoverage(newEvents);

  // Read existing plan and merge
  const existing = readTrackingPlan(cwd);

  // Compute summary stats before merge
  const stats = computeMergeStats(existing?.events ?? [], newEvents);

  const contextWithSequences = scanResult.context
    ? {
        ...scanResult.context,
        expectedSequences: generateExpectedSequences({
          events: newEvents,
          lifecycles: scanResult.context.lifecycles ?? [],
        }),
      }
    : undefined;

  const merged = mergeTrackingPlan(existing, newEvents, scanResult.profile, coverage, contextWithSequences);

  // Update coverage on merged plan (recalculate from merged events)
  merged.coverage = computeCoverage(merged.events);

  writeTrackingPlan(cwd, merged);

  const planPath = getTrackingPlanPath(cwd);

  // Print summary
  console.log();
  console.log(chalk.bold(`📝 Tracking plan updated: ${path.relative(cwd, planPath)}`));
  console.log();
  if (stats.added > 0) console.log(`   ${chalk.green(`${stats.added} new events suggested`)}`);
  if (stats.updated > 0) console.log(`   ${stats.updated} existing events updated`);
  if (stats.confirmed > 0) console.log(`   ${stats.confirmed} implemented event${stats.confirmed !== 1 ? 's' : ''} confirmed`);
  if (stats.unchanged > 0) console.log(`   ${chalk.dim(`${stats.unchanged} events unchanged`)}`);
  console.log();

  const displayEvents = merged.events.filter((e) => e.status !== 'deprecated');
  if (displayEvents.length > 0) {
    console.log('Events:');
    for (const ev of displayEvents) {
      const isNew = !existing?.events.find((e) => e.id === ev.id);
      const prefix = isNew ? chalk.green('+') : '=';
      const statusLabel = ev.status === 'implemented' ? chalk.dim(ev.status) : ev.status;
      const priorityLabel = ev.status !== 'implemented' ? `, ${ev.priority}` : '';
      console.log(`  ${prefix} ${ev.name.padEnd(26)} (${statusLabel}${priorityLabel})`);
    }
  }

  console.log();
  console.log(chalk.dim('Run `logline pr --dry-run` to preview instrumentation for suggested events.'));
}

function gapToEvent(gap: TrackingGap, now: string, context?: TrackingPlanContext): TrackingPlanEvent {
  const parts = gap.suggestedEvent.split('_');
  const action = parts.pop() ?? 'unknown';
  const objectSnake = parts.join('_') || 'unknown';
  const objectPascal = toPascalCase(objectSnake);

  const properties = inferProperties(objectSnake, gap, context);

  return {
    id: generateEventId(gap.suggestedEvent),
    name: gap.suggestedEvent,
    description: gap.description ?? `Fired when ${objectSnake} is ${action}`,
    actor: 'User',
    object: objectPascal,
    action,
    properties: properties.map((p) => ({
      name: p.name,
      // map 'array' → 'object' since EventProperty doesn't have 'array'
      type: (p.type === 'array' ? 'object' : p.type) as EventProperty['type'],
      required: p.required,
      description: p.description,
      todo: p.todo,
    })),
    locations: gap.location ? [gap.location] : [],
    priority: gap.priority ?? 'medium',
    status: 'suggested',
    signalType: gap.signalType ?? 'action',
    includes: gap.includes,
    firstSeen: now,
    lastSeen: now,
  };
}

function toPascalCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

function inferProperties(object: string, gap: TrackingGap, context?: TrackingPlanContext): PropertySpec[] {
  const props: PropertySpec[] = [];

  if (object !== 'unknown') {
    props.push({
      name: `${object}_id`,
      type: 'string',
      required: true,
      description: `Unique identifier of the ${object}`,
    });
  }

  // Context-aware hierarchy enrichment: add parent/grandparent IDs from relationships
  if (context) {
    const parentProps = buildContextProps(object, gap.suggestedEvent, context);
    props.push(...parentProps);
  }

  props.push({
    name: 'user_id',
    type: 'string',
    required: true,
    description: 'ID of the user who performed the action',
  });

  if (gap.suggestedEvent.endsWith('_edited') && gap.includes?.length) {
    props.push({
      name: 'changes',
      type: 'array',
      required: false,
      description: `What was modified: ${gap.includes.join(', ')}`,
    });
  }

  // Sequence-aware properties
  if (gap.suggestedEvent.endsWith('_completed') && context?.lifecycles?.length) {
    const objectSnake = gap.suggestedEvent.replace(/_completed$/, '');
    const hasLifecycle = context.lifecycles.some((lc) => toSnake(lc.object) === objectSnake);
    if (hasLifecycle) {
      props.push({
        name: 'time_to_complete_ms',
        type: 'number',
        required: false,
        description: 'Milliseconds from creation to completion (for funnel analysis)',
        todo: true,
      });
    }
  }

  if (gap.suggestedEvent.endsWith('_failed') && context?.expectedSequences?.length) {
    const base = gap.suggestedEvent.replace(/_failed$/, '');
    const inSequence = context.expectedSequences.some((s) => s.steps.includes(`${base}_tested`));
    if (inSequence) {
      props.push({
        name: 'attempt_number',
        type: 'number',
        required: false,
        description: 'How many times this action was attempted before failing',
        todo: true,
      });
    }
  }

  // De-dup
  const seen = new Set<string>();
  return props.filter((p) => {
    if (seen.has(p.name)) return false;
    seen.add(p.name);
    return true;
  });
}

function buildContextProps(
  objectSnake: string,
  _eventName: string,
  context: TrackingPlanContext
): PropertySpec[] {
  const props: PropertySpec[] = [];
  const relationships = context.relationships ?? [];
  const joinPaths = context.joinPaths ?? [];

  // Direct parents
  const directParents = relationships
    .filter((r) => r.child.toLowerCase() === objectSnake.toLowerCase())
    .map((r) => r.parent);

  for (const parent of directParents) {
    const parentSnake = toSnake(parent);
    if (parentSnake === objectSnake) continue;
    props.push({
      name: `${parentSnake}_id`,
      type: 'string',
      required: true,
      description: `ID of the parent ${parent}`,
      todo: true,
    });
  }

  // Grandparent from join paths (optional)
  const objectPascal = toPascalCase(objectSnake);
  const jp = joinPaths.find(
    (p) => p.from.toLowerCase() === objectPascal.toLowerCase() && p.via.length >= 2
  );
  if (jp) {
    const gpSnake = toSnake(jp.to);
    if (gpSnake !== objectSnake && !directParents.map(toSnake).includes(gpSnake)) {
      props.push({
        name: `${gpSnake}_id`,
        type: 'string',
        required: false,
        description: `ID of the grandparent ${jp.to} (for cross-entity correlation)`,
        todo: true,
      });
    }
  }

  return props;
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function computeCoverage(events: TrackingPlanEvent[]): CoverageStats {
  const active = events.filter((e) => e.status !== 'deprecated');
  const implemented = active.filter((e) => e.status === 'implemented').length;
  const suggested = active.filter((e) => e.status === 'suggested').length;
  const approved = active.filter((e) => e.status === 'approved').length;
  const total = active.length;
  return {
    tracked: implemented,
    suggested,
    approved,
    implemented,
    percentage: total > 0 ? Math.round((implemented / total) * 100) : 0,
  };
}

interface MergeStats {
  added: number;
  updated: number;
  confirmed: number;
  unchanged: number;
}

function computeMergeStats(
  existingEvents: TrackingPlanEvent[],
  newEvents: TrackingPlanEvent[]
): MergeStats {
  const existingById = new Map(existingEvents.map((e) => [e.id, e]));
  const newById = new Set(newEvents.map((e) => e.id));

  let added = 0;
  let updated = 0;
  let confirmed = 0;

  for (const newEvent of newEvents) {
    const existing = existingById.get(newEvent.id);
    if (!existing) {
      added++;
    } else if (existing.status === 'suggested') {
      updated++;
    } else if (existing.status === 'implemented') {
      confirmed++;
    }
  }

  // Events in existing plan not touched by new scan
  const unchanged = existingEvents.filter((e) => !newById.has(e.id)).length;

  return { added, updated, confirmed, unchanged };
}
