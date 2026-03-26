import chalk from 'chalk';
import { readTrackingPlan } from '../lib/utils/tracking-plan';
import type { TrackingPlan, TrackingPlanContext, TrackingPlanEvent, TrackingPlanMetric } from '../lib/types';

type ContextFormat = 'text' | 'mermaid' | 'json';

export async function contextCommand(options: {
  cwd?: string;
  format?: ContextFormat;
  json?: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const plan = readTrackingPlan(cwd);
  if (!plan) {
    console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first.'));
    return;
  }

  const format: ContextFormat = options.json ? 'json' : options.format ?? 'text';

  if (format === 'json') {
    process.stdout.write(JSON.stringify(buildAgentJson(plan), null, 2) + '\n');
    return;
  }

  if (format === 'mermaid') {
    process.stdout.write(buildMermaid(plan) + '\n');
    return;
  }

  process.stdout.write(buildHumanReadable(plan) + '\n');
}

function buildHumanReadable(plan: TrackingPlan): string {
  const ctx = plan.context;
  const title = `📊 Logline Context — ${plan.product?.mission || 'Product'}`;

  const lines: string[] = [chalk.bold(title), ''];

  if (!ctx) {
    lines.push(chalk.dim('No context extracted yet. Re-run `logline spec` after scanning a codebase with domain models.'));
    return lines.join('\n');
  }

  lines.push(chalk.bold('Actors:'));
  if (ctx.actors?.length) {
    for (const a of ctx.actors) {
      lines.push(`  ${a.name} (${a.identifierPattern}) — ${a.detectedFrom}`);
    }
  } else {
    lines.push(chalk.dim('  (none detected)'));
  }
  lines.push('');

  lines.push(chalk.bold('Objects:'));
  if (ctx.objects?.length) {
    for (const o of ctx.objects) {
      const props = o.properties?.length ? ` [${o.properties.join(', ')}]` : '';
      const belongs = o.belongsTo?.length ? `    Belongs to: ${o.belongsTo.join(', ')}` : '';
      lines.push(`  ${o.name}${props}`);
      const lc = (ctx.lifecycles ?? []).find((l) => l.object.toLowerCase() === o.name.toLowerCase());
      if (lc?.states?.length) {
        lines.push(`    States: ${lc.states.join(' → ')}`);
      }
      if (belongs) lines.push(belongs);
    }
  } else {
    lines.push(chalk.dim('  (none detected)'));
  }
  lines.push('');

  lines.push(chalk.bold('Join Paths:'));
  if (ctx.joinPaths?.length) {
    for (const jp of ctx.joinPaths.slice(0, 12)) {
      lines.push(`  ${jp.from} → ${jp.to}: ${jp.via.join(' → ')}`);
    }
    if (ctx.joinPaths.length > 12) lines.push(chalk.dim(`  ... and ${ctx.joinPaths.length - 12} more`));
  } else {
    lines.push(chalk.dim('  (none)'));
  }
  lines.push('');

  lines.push(chalk.bold('Event Sequences:'));
  if (ctx.expectedSequences?.length) {
    for (const s of ctx.expectedSequences) {
      lines.push(`  ${s.name}: ${s.steps.join(' → ')} (expected: ${s.expectedWindow})`);
    }
  } else {
    lines.push(chalk.dim('  (none)'));
  }
  lines.push('');

  lines.push(chalk.bold('Metrics Enabled:'));
  if (plan.metrics?.length) {
    for (const m of plan.metrics.slice(0, 12)) {
      lines.push(`  ✓ ${m.name.padEnd(28)} (${m.category}, ${m.grain})`);
    }
    if (plan.metrics.length > 12) lines.push(chalk.dim(`  ... and ${plan.metrics.length - 12} more`));
  } else {
    lines.push(chalk.dim('  (none — run `logline metrics`)'));
  }

  return lines.join('\n');
}

function buildMermaid(plan: TrackingPlan): string {
  const ctx = plan.context;
  const lines: string[] = ['```mermaid', 'graph LR'];
  if (!ctx) {
    lines.push('  Product[No context extracted]');
    lines.push('```');
    return lines.join('\n');
  }

  for (const a of ctx.actors ?? []) {
    lines.push(`  ${sanitizeNode(a.name)}[${a.name}]`);
  }
  for (const o of ctx.objects ?? []) {
    lines.push(`  ${sanitizeNode(o.name)}[${o.name}]`);
  }
  for (const r of ctx.relationships ?? []) {
    lines.push(`  ${sanitizeNode(r.parent)} -->|${r.relationship}| ${sanitizeNode(r.child)}`);
  }

  for (const lc of ctx.lifecycles ?? []) {
    if (!lc.states?.length) continue;
    lines.push(`  subgraph "${lc.object} Lifecycle"`);
    for (let i = 0; i < lc.states.length - 1; i++) {
      lines.push(`    ${sanitizeNode(lc.states[i])} --> ${sanitizeNode(lc.states[i + 1])}`);
    }
    lines.push('  end');
  }

  lines.push('```');
  return lines.join('\n');
}

function buildAgentJson(plan: TrackingPlan): {
  product: TrackingPlan['product'];
  actors: TrackingPlanContext['actors'];
  objects: TrackingPlanContext['objects'];
  relationships: TrackingPlanContext['relationships'];
  lifecycles: TrackingPlanContext['lifecycles'];
  joinPaths?: TrackingPlanContext['joinPaths'];
  expectedSequences?: TrackingPlanContext['expectedSequences'];
  events: Array<Pick<TrackingPlanEvent, 'name' | 'priority' | 'status' | 'includes'>>;
  metrics: Array<Pick<TrackingPlanMetric, 'name' | 'formula' | 'category' | 'grain' | 'events'>>;
} {
  const ctx = plan.context ?? { actors: [], objects: [], relationships: [], lifecycles: [] };
  return {
    product: plan.product,
    actors: ctx.actors,
    objects: ctx.objects,
    relationships: ctx.relationships,
    lifecycles: ctx.lifecycles,
    joinPaths: ctx.joinPaths,
    expectedSequences: ctx.expectedSequences,
    events: (plan.events ?? []).map((e) => ({
      name: e.name,
      priority: e.priority,
      status: e.status,
      includes: e.includes,
    })),
    metrics: (plan.metrics ?? []).map((m) => ({
      name: m.name,
      formula: m.formula,
      category: m.category,
      grain: m.grain,
      events: m.events,
    })),
  };
}

function sanitizeNode(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}

