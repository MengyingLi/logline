import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { readTrackingPlan, writeTrackingPlan } from '../lib/utils/tracking-plan';
import { readLoglineConfig } from '../lib/utils/config';
import { generateTrackingCode } from '../lib/utils/code-generator';
import { getEffectiveTargetLine, insertTracking, ensureTrackImport } from './pr';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';
import type { TrackingPlanEvent } from '../lib/types';

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export async function applyCommand(options: { cwd?: string; eventName?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  // ── Single-event mode ──────────────────────────────────────────────────────
  if (options.eventName) {
    const plan = readTrackingPlan(cwd);
    if (!plan) {
      console.log('No tracking plan found. Run `logline init && logline spec` first.');
      return;
    }
    const existing = plan.events.find((e) => e.name === options.eventName);
    if (!existing) {
      console.log(`Event "${options.eventName}" not found in tracking plan.`);
      return;
    }
    if (existing.status !== 'suggested') {
      console.log(`Event "${options.eventName}" is already ${existing.status}.`);
      return;
    }
    const result = await applyEvent(cwd, options.eventName);
    if (result.success) {
      console.log(`${chalk.green('✓')} Applied ${options.eventName} to ${result.file}:${result.line}`);
    } else {
      console.log(`Could not apply "${options.eventName}" — file not found or location unknown.`);
    }
    return;
  }

  // ── Interactive mode ───────────────────────────────────────────────────────
  const plan = readTrackingPlan(cwd);
  if (!plan) {
    console.log('No tracking plan found. Run `logline init && logline spec` first.');
    return;
  }

  const suggested = plan.events
    .filter((e) => e.status === 'suggested')
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 3;
      const pb = PRIORITY_ORDER[b.priority] ?? 3;
      if (pa !== pb) return pa - pb;
      const fa = a.locations?.[0]?.file ?? '';
      const fb = b.locations?.[0]?.file ?? '';
      return fa.localeCompare(fb);
    });

  if (suggested.length === 0) {
    console.log('No suggested events to apply. Run `logline spec` to find new events.');
    return;
  }

  const config = readLoglineConfig(cwd);
  const loggingOpts = config.logging
    ? { importPath: config.logging.importPath, instanceName: config.logging.instanceName }
    : undefined;

  let applied = 0;
  let skipped = 0;
  let shouldQuit = false;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  for (let i = 0; i < suggested.length && !shouldQuit; i++) {
    const event = suggested[i];
    const location = event.locations?.[0];

    if (!location || location.file === 'unknown' || !location.file) {
      skipped++;
      continue;
    }

    const filePath = path.join(cwd, location.file);
    if (!fs.existsSync(filePath)) {
      skipped++;
      continue;
    }

    let currentName = event.name;
    let done = false;

    while (!done && !shouldQuit) {
      // Re-read file each iteration — accepts from earlier events may have shifted lines.
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      const gap = eventToGap(event, currentName);
      const { line: targetLine, exact } = getEffectiveTargetLine(content, gap);
      const trackingCode = generateTrackingCode(gap, content, targetLine, {
        functionName: config.tracking.functionName,
        signalType: gap.signalType,
        logging: loggingOpts,
      });

      // ── Display preview ─────────────────────────────────────────────────
      console.log();
      console.log(chalk.dim('─'.repeat(45)));
      console.log(
        `[${i + 1}/${suggested.length}] ${chalk.bold(currentName)} ${chalk.dim(`(${event.priority})`)}`
      );
      console.log(chalk.dim(`${location.file}:${targetLine}`));
      console.log();

      const startLine = Math.max(0, targetLine - 4);
      const endLine = Math.min(lines.length, targetLine + 2);

      for (let li = startLine; li < targetLine; li++) {
        console.log(`${String(li + 1).padStart(3)} │ ${lines[li]}`);
      }

      const targetIdx = targetLine - 1; // 0-indexed
      const atClosingBrace = exact && /^\s*\}\)/.test(lines[targetIdx] ?? '');
      const indentRef = atClosingBrace ? Math.max(0, targetIdx - 1) : targetIdx;
      const indent = lines[indentRef]?.match(/^(\s*)/)?.[1] ?? '  ';
      for (const codeLine of trackingCode.trim().split('\n')) {
        console.log(chalk.green(`    │ ${indent}${codeLine}`));
      }

      for (let li = targetLine; li < endLine; li++) {
        console.log(`${String(li + 1).padStart(3)} │ ${lines[li]}`);
      }

      console.log();
      const answer = (await ask('[a]ccept  [s]kip  [e]dit name  [q]uit\n> ')).trim().toLowerCase();

      if (answer === 'q' || answer === 'quit') {
        shouldQuit = true;
      } else if (answer === 's' || answer === 'skip') {
        skipped++;
        done = true;
      } else if (answer === 'a' || answer === 'accept') {
        const updated = insertTracking(content, targetLine, trackingCode, exact);
        const withImport = ensureTrackImport(
          updated,
          location.file,
          config.tracking.importPath,
          config.tracking.functionName
        );
        fs.writeFileSync(filePath, withImport);

        // Update status immediately so progress survives a quit.
        const freshPlan = readTrackingPlan(cwd)!;
        freshPlan.events = freshPlan.events.map((e) =>
          e.id === event.id ? { ...e, status: 'approved' as const } : e
        );
        writeTrackingPlan(cwd, freshPlan);

        console.log(`${chalk.green('✓')} Applied ${currentName} to ${location.file}`);
        applied++;
        done = true;
      } else if (answer === 'e' || answer === 'edit') {
        const newName = (await ask('New event name: ')).trim();
        if (newName) currentName = newName;
        // Loop — re-display with updated name.
      }
    }
  }

  rl.close();
  const remaining = suggested.length - applied - skipped;
  console.log(
    `\nDone! Applied ${applied} event${applied !== 1 ? 's' : ''}, skipped ${skipped}, ${remaining} remaining.`
  );
  console.log('Run git diff to review changes.');
  console.log('Run logline status to see updated coverage.');
}

/** Apply a single named event non-interactively. Exported for programmatic/MCP use. */
export async function applyEvent(
  cwd: string,
  eventName: string
): Promise<{ success: boolean; file: string; line: number; code: string }> {
  const plan = readTrackingPlan(cwd);
  if (!plan) return { success: false, file: '', line: 0, code: '' };

  const event = plan.events.find((e) => e.name === eventName && e.status === 'suggested');
  if (!event) return { success: false, file: '', line: 0, code: '' };

  const location = event.locations?.[0];
  if (!location || location.file === 'unknown' || !location.file) {
    return { success: false, file: '', line: 0, code: '' };
  }

  const config = readLoglineConfig(cwd);
  const filePath = path.join(cwd, location.file);
  if (!fs.existsSync(filePath)) return { success: false, file: '', line: 0, code: '' };

  const content = fs.readFileSync(filePath, 'utf-8');
  const gap = eventToGap(event, event.name);
  const { line: targetLine, exact } = getEffectiveTargetLine(content, gap);
  const trackingCode = generateTrackingCode(gap, content, targetLine, {
    functionName: config.tracking.functionName,
    signalType: gap.signalType,
    logging: config.logging
      ? { importPath: config.logging.importPath, instanceName: config.logging.instanceName }
      : undefined,
  });

  const updated = insertTracking(content, targetLine, trackingCode, exact);
  const withImport = ensureTrackImport(
    updated,
    location.file,
    config.tracking.importPath,
    config.tracking.functionName
  );
  fs.writeFileSync(filePath, withImport);

  plan.events = plan.events.map((e) =>
    e.id === event.id ? { ...e, status: 'approved' as const } : e
  );
  writeTrackingPlan(cwd, plan);

  return { success: true, file: location.file, line: targetLine, code: trackingCode };
}

function eventToGap(event: TrackingPlanEvent, name: string): TrackingGap {
  return {
    suggestedEvent: name,
    reason: event.description,
    location: event.locations?.[0] ?? { file: 'unknown', line: 0 },
    confidence: 0.8,
    priority: event.priority,
    signalType: event.signalType,
    description: event.description,
    includes: event.includes,
  };
}
