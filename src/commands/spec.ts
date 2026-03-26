import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { scanCommand } from './scan';
import type { TrackingPlanEvent, EventProperty, CoverageStats } from '../lib/types';
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
    gapToEvent(gap, now)
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

function gapToEvent(gap: TrackingGap, now: string): TrackingPlanEvent {
  const parts = gap.suggestedEvent.split('_');
  const action = parts.pop() ?? 'unknown';
  const objectSnake = parts.join('_') || 'unknown';
  const objectPascal = toPascalCase(objectSnake);

  const properties = inferProperties(objectSnake, gap);

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
    })),
    locations: gap.location ? [gap.location] : [],
    priority: gap.priority ?? 'medium',
    status: 'suggested',
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

function inferProperties(object: string, gap: TrackingGap): PropertySpec[] {
  const props: PropertySpec[] = [];

  props.push({
    name: `${object}_id`,
    type: 'string',
    required: true,
    description: `Unique identifier of the ${object}`,
  });

  props.push({
    name: 'user_id',
    type: 'string',
    required: true,
    description: 'ID of the user who performed the action',
  });

  if (object.includes('workflow')) {
    props.push({ name: 'workflow_name', type: 'string', required: false });
  }

  if (gap.suggestedEvent.endsWith('_edited') && gap.includes?.length) {
    props.push({
      name: 'changes',
      type: 'array',
      required: false,
      description: `What was modified: ${gap.includes.join(', ')}`,
    });
  }

  return props;
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
