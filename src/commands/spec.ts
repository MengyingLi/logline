import * as fs from 'fs';
import * as path from 'path';
import { scanCommand } from './scan';
import type { ProductProfile } from '../lib/types';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';

export interface EventSpec {
  eventName: string;
  description: string;
  actor: string;
  object: string;
  action: string;
  properties: PropertySpec[];
  suggestedLocations: Array<{
    file: string;
    line: number;
    hint?: string;
  }>;
  priority: 'critical' | 'high' | 'medium' | 'low';
  includes?: string[];
  generatedAt: string;
}

export interface PropertySpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
}

export async function specAllCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // Load scan results (run scan if needed)
  const scanResult = await scanCommand({ cwd });

  const specsDir = path.join(cwd, '.logline', 'specs');
  fs.mkdirSync(specsDir, { recursive: true });

  console.log(`\n📝 Generating specs for ${scanResult.gaps.length} events...\n`);

  for (const gap of scanResult.gaps) {
    const spec = generateSpec(gap, scanResult.profile);
    const specPath = path.join(specsDir, `${gap.suggestedEvent}.json`);
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    console.log(`  ✓ ${gap.suggestedEvent.padEnd(24)} → ${specPath}`);
  }

  console.log(`\nGenerated ${scanResult.gaps.length} specs in .logline/specs/`);
  console.log('Run `logline apply --dry-run` to preview instrumentation.');
}

function generateSpec(gap: TrackingGap, profile?: ProductProfile | null): EventSpec {
  // Parse event name to extract actor/object/action
  const parts = gap.suggestedEvent.split('_');
  const action = parts.pop() || 'unknown';
  const object = parts.join('_') || 'unknown';

  // Generate properties based on object type
  const properties = inferProperties(object, gap);

  const hint = gap.hint ?? gap.location?.hint;
  const suggestedLocations = gap.location
    ? [{ file: gap.location.file, line: gap.location.line, hint }]
    : [];

  return {
    eventName: gap.suggestedEvent,
    description: gap.description ?? `Fired when ${object} is ${action}`,
    actor: 'User',
    object: toPascalCase(object),
    action,
    properties,
    suggestedLocations,
    priority: gap.priority ?? 'medium',
    includes: gap.includes,
    generatedAt: new Date().toISOString(),
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

  // Always include object ID
  props.push({
    name: `${object}_id`,
    type: 'string',
    required: true,
    description: `Unique identifier of the ${object}`,
  });

  // Add user_id for user-initiated actions
  props.push({
    name: 'user_id',
    type: 'string',
    required: true,
    description: 'ID of the user who performed the action',
  });

  // Add common properties based on object type
  if (object.includes('workflow')) {
    props.push({ name: 'workflow_name', type: 'string', required: false });
  }

  // If it's an "edited" event, track what changed
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
