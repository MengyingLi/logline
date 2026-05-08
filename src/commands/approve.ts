import * as readline from 'readline';
import chalk from 'chalk';
import { readTrackingPlan, writeTrackingPlan } from '../lib/utils/tracking-plan';
import { priorityLabel } from '../lib/utils/format';
import type { TrackingPlanEvent, TrackingPlan } from '../lib/types';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function recalcCoverage(plan: TrackingPlan): void {
  const events = plan.events.filter((e) => e.status !== 'deprecated');
  const implemented = events.filter((e) => e.status === 'implemented').length;
  const suggested = events.filter((e) => e.status === 'suggested').length;
  const approved = events.filter((e) => e.status === 'approved').length;
  const percentage = events.length > 0 ? Math.round((implemented / events.length) * 100) : 0;
  plan.coverage = { ...plan.coverage, tracked: implemented, suggested, approved, implemented, percentage };
}

function updateEvents(plan: TrackingPlan, eventName: string | undefined, all: boolean): { updated: number } {
  let updated = 0;
  const targets = all
    ? new Set(plan.events.filter((e) => e.status === 'suggested').map((e) => e.id))
    : new Set(plan.events.filter((e) => e.name === eventName).map((e) => e.id));

  plan.events = plan.events.map((e) => {
    if (!targets.has(e.id)) return e;
    if (e.status === 'suggested') { updated++; return { ...e, status: 'approved' as const }; }
    return e;
  });
  return { updated };
}

// ─── Interactive mode ─────────────────────────────────────────────────────────

async function runInteractive(cwd: string, plan: TrackingPlan): Promise<void> {
  const suggested = plan.events
    .filter((e) => e.status === 'suggested')
    .sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3));

  if (suggested.length === 0) {
    console.log(chalk.dim('No suggested events to review. Run `logline spec` to find new events.'));
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim().toLowerCase())));

  let approved = 0, rejected = 0, skipped = 0;

  for (let i = 0; i < suggested.length; i++) {
    const event = suggested[i];
    const loc = event.locations?.[0];

    console.log();
    console.log(chalk.dim('─'.repeat(50)));
    console.log(
      `[${i + 1}/${suggested.length}] ${chalk.bold(event.name)}  ${priorityLabel(event.priority)}`
    );
    if (loc?.file) {
      console.log(chalk.dim(`${loc.file}${loc.line ? `:${loc.line}` : ''}`));
    }
    if (event.description) {
      console.log(chalk.dim(event.description));
    }
    if (event.properties?.length) {
      const props = event.properties.map((p) => `${p.name}${p.required ? '' : '?'}`).join(', ');
      console.log(chalk.dim(`Props: ${props}`));
    }
    console.log();

    const answer = await ask(`[a]pprove  [s]kip  [r]eject  [q]uit\n${chalk.cyan('>')} `);

    if (answer === 'q' || answer === 'quit') break;

    if (answer === 'a' || answer === 'approve') {
      // Re-read each time so concurrent edits don't clobber each other
      const fresh = readTrackingPlan(cwd)!;
      fresh.events = fresh.events.map((e) =>
        e.id === event.id ? { ...e, status: 'approved' as const } : e
      );
      recalcCoverage(fresh);
      writeTrackingPlan(cwd, fresh);
      console.log(`${chalk.green('✓')} Approved ${chalk.bold(event.name)}`);
      approved++;
    } else if (answer === 'r' || answer === 'reject') {
      const fresh = readTrackingPlan(cwd)!;
      fresh.events = fresh.events.map((e) =>
        e.id === event.id ? { ...e, status: 'deprecated' as const } : e
      );
      recalcCoverage(fresh);
      writeTrackingPlan(cwd, fresh);
      console.log(`${chalk.dim(`✗ Rejected ${event.name}`)}`);
      rejected++;
    } else {
      skipped++;
    }
  }

  rl.close();
  console.log();
  console.log(
    `Done! Approved ${chalk.green(String(approved))}, rejected ${rejected}, skipped ${skipped}.`
  );
  if (approved > 0) {
    console.log(`Run ${chalk.cyan('logline apply')} to instrument approved events.`);
  }
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function approveCommand(options: {
  cwd?: string;
  eventName?: string;
  all: boolean;
  interactive?: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const plan = readTrackingPlan(cwd);
  if (!plan) {
    console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first.'));
    return;
  }

  // Interactive mode: no args, or explicit --interactive flag
  const wantsInteractive =
    options.interactive || (!options.all && !options.eventName);

  if (wantsInteractive) {
    await runInteractive(cwd, plan);
    return;
  }

  // Batch / single-event mode
  const { updated } = updateEvents(plan, options.eventName, options.all);
  if (updated === 0) {
    console.log(chalk.dim('No suggested events matched. Nothing to approve.'));
    return;
  }

  recalcCoverage(plan);
  writeTrackingPlan(cwd, plan);
  console.log(chalk.bold(`✓ Approved ${updated} event${updated === 1 ? '' : 's'}`));
}
