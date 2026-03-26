import chalk from 'chalk';
import { readTrackingPlan, writeTrackingPlan } from '../lib/utils/tracking-plan';
import type { TrackingPlanEvent, TrackingPlan } from '../lib/types';

function updateEvents(plan: TrackingPlan, eventName: string | undefined, all: boolean): { updated: number } {
  let updated = 0;
  const targets = all
    ? new Set(plan.events.filter((e) => e.status === 'suggested').map((e) => e.id))
    : new Set(plan.events.filter((e) => e.name === eventName).map((e) => e.id));

  plan.events = plan.events.map((e) => {
    if (!targets.has(e.id)) return e;
    if (e.status === 'suggested') {
      updated += 1;
      return { ...e, status: 'approved' as const };
    }
    return e;
  });

  return { updated };
}

function recalcCoverage(plan: TrackingPlan): void {
  const events = plan.events.filter((e) => e.status !== 'deprecated');
  const implemented = events.filter((e) => e.status === 'implemented').length;
  const suggested = events.filter((e) => e.status === 'suggested').length;
  const approved = events.filter((e) => e.status === 'approved').length;
  const percentage = events.length > 0 ? Math.round((implemented / events.length) * 100) : 0;
  plan.coverage = {
    ...plan.coverage,
    tracked: implemented,
    suggested,
    approved,
    implemented,
    percentage,
  };
}

export async function approveCommand(options: {
  cwd?: string;
  eventName?: string;
  all: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const plan = readTrackingPlan(cwd);
  if (!plan) {
    console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first.'));
    return;
  }

  if (!options.all && !options.eventName) {
    console.log(chalk.dim('Usage: logline approve <eventName> OR logline approve --all'));
    return;
  }

  const { updated } = updateEvents(plan, options.eventName, options.all);
  if (updated === 0) {
    console.log(chalk.dim('No suggested events matched. Nothing to approve.'));
    return;
  }

  recalcCoverage(plan);
  writeTrackingPlan(cwd, plan);
  console.log(chalk.bold(`✓ Approved ${updated} event${updated === 1 ? '' : 's'}`));
}

