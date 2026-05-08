import chalk from 'chalk';
import { readTrackingPlan } from '../lib/utils/tracking-plan';
import { coverageBar, priorityLabel, trunc } from '../lib/utils/format';
import type { TrackingPlanEvent } from '../lib/types';

function timeAgo(iso: string): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diffMs / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function countByStatus(events: TrackingPlanEvent[]): Record<TrackingPlanEvent['status'], number> {
  const out = { suggested: 0, approved: 0, implemented: 0, deprecated: 0 };
  for (const e of events) out[e.status]++;
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
  const pct = plan.coverage?.percentage ?? 0;

  console.log(chalk.bold('📊 Logline Status'));
  console.log();

  // ── Coverage bar ────────────────────────────────────────────────────────────
  const bar = coverageBar(pct);
  console.log(`  ${bar}  ${chalk.bold(`${pct}%`)}  ${chalk.dim(`${counts.implemented} tracked · ${total} total`)}`);
  console.log();

  // ── Events by status ────────────────────────────────────────────────────────
  const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
  const byPriority = (a: TrackingPlanEvent, b: TrackingPlanEvent) =>
    PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);

  const approved = plan.events.filter((e) => e.status === 'approved').sort(byPriority);
  const suggested = plan.events.filter((e) => e.status === 'suggested').sort(byPriority);

  if (approved.length > 0) {
    console.log(chalk.bold(`  Ready to instrument  ${chalk.dim(`(${approved.length})`)}`));
    for (const e of approved.slice(0, 5)) {
      const loc = e.locations?.[0]?.file ? chalk.dim(trunc(e.locations[0].file, 36)) : '';
      console.log(`    ${chalk.green('→')} ${trunc(e.name, 30)} ${loc}  ${priorityLabel(e.priority)}`);
    }
    if (approved.length > 5) {
      console.log(chalk.dim(`    … and ${approved.length - 5} more`));
    }
    console.log();
  }

  if (suggested.length > 0) {
    console.log(chalk.bold(`  Needs review  ${chalk.dim(`(${suggested.length})`)}`));
    for (const e of suggested.slice(0, 5)) {
      const loc = e.locations?.[0]?.file ? chalk.dim(trunc(e.locations[0].file, 36)) : '';
      console.log(`    ${chalk.yellow('○')} ${trunc(e.name, 30)} ${loc}  ${priorityLabel(e.priority)}`);
    }
    if (suggested.length > 5) {
      console.log(chalk.dim(`    … and ${suggested.length - 5} more — run \`logline scan\` to see all`));
    }
    console.log();
  }

  if (approved.length === 0 && suggested.length === 0 && counts.implemented > 0) {
    console.log(`  ${chalk.green('✓')} All events are instrumented`);
    console.log();
  }

  // ── Stats row ───────────────────────────────────────────────────────────────
  const parts: string[] = [];
  if (counts.approved)     parts.push(`${counts.approved} approved`);
  if (counts.suggested)    parts.push(`${counts.suggested} suggested`);
  if (counts.implemented)  parts.push(`${counts.implemented} implemented`);
  if (counts.deprecated)   parts.push(chalk.dim(`${counts.deprecated} deprecated`));
  console.log(`  ${chalk.dim(parts.join('  ·  '))}`);

  if (plan.generatedAt) {
    console.log(`  ${chalk.dim(`Last scan: ${timeAgo(plan.generatedAt)}`)}`);
  }
  console.log();

  // ── Next action ─────────────────────────────────────────────────────────────
  if (approved.length > 0) {
    console.log(`  ${chalk.cyan('→')} Run ${chalk.cyan('logline apply')} to instrument approved events`);
  } else if (suggested.length > 0) {
    console.log(`  ${chalk.cyan('→')} Run ${chalk.cyan('logline apply')} to review and instrument suggested events`);
  } else if (total === 0) {
    console.log(`  ${chalk.cyan('→')} Run ${chalk.cyan('logline scan')} to find missing analytics events`);
  }
}
