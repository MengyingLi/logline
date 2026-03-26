import chalk from 'chalk';
import { readTrackingPlan } from '../lib/utils/tracking-plan';
import type { TrackingPlanEvent, TrackingPlan } from '../lib/types';

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - t);
  const diffMinutes = Math.floor(diffMs / 60000);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 48) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function countByStatus(events: TrackingPlanEvent[]): Record<TrackingPlanEvent['status'], number> {
  const out = { suggested: 0, approved: 0, implemented: 0, deprecated: 0 };
  for (const e of events) {
    out[e.status] += 1;
  }
  return out;
}

export async function statusCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const plan = readTrackingPlan(cwd);
  if (!plan) {
    console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first.'));
    return;
  }

  const counts = countByStatus(plan.events);
  const total = plan.events.length;
  const coverage = plan.coverage ?? { tracked: counts.implemented, missing: counts.suggested + counts.approved, percentage: 0 };

  console.log(chalk.bold('📊 Logline Status'));
  console.log();
  console.log(`  Events: ${total} total`);
  console.log(`    ${counts.suggested} suggested${counts.suggested ? ' (run logline pr to implement)' : ''}`);
  console.log(`    ${counts.approved} approved${counts.approved ? ' (run logline pr to implement)' : ''}`);
  console.log(`    ${counts.implemented} implemented`);
  console.log(`    ${counts.deprecated} deprecated`);
  console.log();
  console.log(`  Coverage: ${coverage.percentage}% (${coverage.tracked} of ${total} events tracked)`);
  console.log();
  if (plan.generatedAt) {
    console.log(`  Last scan: ${timeAgo(plan.generatedAt)}`);
  }
}

