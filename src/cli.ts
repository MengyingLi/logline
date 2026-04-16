#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init';
import { scanCommand } from './commands/scan';
import { specCommand } from './commands/spec';
import { prCommand } from './commands/pr';
import { statusCommand } from './commands/status';
import { approveCommand } from './commands/approve';
import { rejectCommand } from './commands/reject';
import { metricsCommand } from './commands/metrics';
import { contextCommand } from './commands/context';
import { exportCommand } from './commands/export';
import { doctorCommand } from './commands/doctor';

const program = new Command();

program
  .name('logline')
  .description('Logline — semantic layer for product analytics. Generates tracking plans from codebases.')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Logline in your project')
  .action(async () => {
    console.log(chalk.bold('\n📦 Initializing Logline...\n'));
    await initCommand({});
  });

program
  .command('scan')
  .description('Analyze product + tracking coverage + suggested events')
  .option('--fast', 'Skip LLM product reasoning')
  .option('--deep', 'Use deeper (slower) analysis where available')
  .option('--granular', 'Show all granular interactions (no business-event grouping)')
  .option('--verbose', 'Verbose output (files, interactions, LLM previews)')
  .option('--json', 'Output scan results as JSON to stdout (no colors/spinners)')
  .action(async (opts) => {
    if (!opts.json) console.log(chalk.bold('\n🔬 Analyzing your product...\n'));

    const result = await scanCommand({
      fast: Boolean(opts.fast),
      deep: Boolean(opts.deep),
      granular: Boolean(opts.granular),
      verbose: Boolean(opts.verbose),
      json: Boolean(opts.json),
    });
    if (opts.json) {
      process.stdout.write(JSON.stringify(result));
      process.stdout.write('\n');
      return;
    }
    printScanResult(result);
  });

program
  .command('spec')
  .description('Generate or update the tracking plan')
  .action(async () => {
    await specCommand({});
  });

program
  .command('pr')
  .description('Generate a Pull Request with analytics instrumentation')
  .option('--dry-run', 'Preview changes without creating PR')
  .option('--title <title>', 'Custom PR title')
  .option('--base <branch>', 'Base branch for PR', 'main')
  .action(async (opts) => {
    await prCommand({
      dryRun: opts.dryRun,
      title: opts.title,
      baseBranch: opts.base,
    });
  });

program
  .command('status')
  .description('Show tracking plan summary (no rescan)')
  .option('--cwd <cwd>', 'Working directory')
  .action(async (opts) => {
    await statusCommand({ cwd: opts.cwd ? String(opts.cwd) : undefined });
  });

program
  .command('approve [eventName]')
  .description('Mark a suggested/approved event as approved')
  .option('--cwd <cwd>', 'Working directory')
  .option('--all', 'Approve all suggested events')
  .action(async (eventName: string | undefined, opts: any) => {
    await approveCommand({
      cwd: opts.cwd ? String(opts.cwd) : undefined,
      eventName: eventName ? String(eventName) : undefined,
      all: Boolean(opts.all),
    });
  });

program
  .command('reject [eventName]')
  .description('Mark an event as deprecated')
  .option('--cwd <cwd>', 'Working directory')
  .option('--all', 'Deprecate all suggested/approved events')
  .action(async (eventName: string | undefined, opts: any) => {
    await rejectCommand({
      cwd: opts.cwd ? String(opts.cwd) : undefined,
      eventName: eventName ? String(eventName) : undefined,
      all: Boolean(opts.all),
    });
  });

program
  .command('metrics')
  .description('Generate metrics from tracking plan context')
  .option('--cwd <cwd>', 'Working directory')
  .option('--format <format>', 'Output format: json | yaml')
  .action(async (opts) => {
    const format =
      opts.format === 'json' || opts.format === 'yaml' ? (opts.format as 'json' | 'yaml') : undefined;
    await metricsCommand({ cwd: opts.cwd ? String(opts.cwd) : undefined, format });
  });

program
  .command('context')
  .description('Show agent-readable product ontology from tracking plan')
  .option('--cwd <cwd>', 'Working directory')
  .option('--format <format>', 'Output format: text | mermaid | json')
  .option('--json', 'Output JSON (same as --format json)')
  .action(async (opts) => {
    const format =
      opts.format === 'text' || opts.format === 'mermaid' || opts.format === 'json'
        ? (opts.format as 'text' | 'mermaid' | 'json')
        : undefined;
    await contextCommand({
      cwd: opts.cwd ? String(opts.cwd) : undefined,
      format,
      json: Boolean(opts.json),
    });
  });

program
  .command('export')
  .description('Export tracking plan to external tool formats')
  .option('--format <format>', 'Output format: segment | amplitude | opentelemetry | glassflow', 'segment')
  .option('--output <path>', 'Output file path (default: <format>-tracking-plan.json)')
  .option('--cwd <cwd>', 'Working directory')
  .action(async (opts) => {
    const format = opts.format as 'segment' | 'amplitude' | 'opentelemetry' | 'glassflow';
    await exportCommand({
      cwd: opts.cwd ? String(opts.cwd) : undefined,
      format,
      output: opts.output ? String(opts.output) : undefined,
    });
  });

program
  .command('doctor')
  .description('Check environment (Node version, API key, git, gh CLI, tracking plan)')
  .option('--cwd <cwd>', 'Working directory')
  .action(async (opts) => {
    await doctorCommand({ cwd: opts.cwd ? String(opts.cwd) : undefined });
  });

program.parseAsync();

function printScanResult(result: Awaited<ReturnType<typeof scanCommand>>): void {
  // Always display actual scan result: result.gaps (suggested) and result.events (already tracked).
  // Never use fallbacks or default event lists.
  const gaps: Array<{ suggestedEvent: string; priority: string; location?: { file?: string; line?: number }; description?: string; includes?: string[]; hint?: string }> = Array.isArray(result.gaps) ? result.gaps : [];
  const events: Array<{ name: string; locations?: Array<{ file?: string; line?: number }> }> = Array.isArray(result.events) ? result.events : [];
  const coverage = result.coverage ?? { tracked: events.length, missing: gaps.length, percentage: 0 };

  // Product profile
  console.log(chalk.bold('📊 Product Profile'));
  console.log(`   Mission: ${result.profile?.mission ?? 'Not analyzed'}`);
  if (result.profile?.keyMetrics?.length) {
    console.log(`   Key Metrics: ${result.profile.keyMetrics.join(', ')}`);
  }
  console.log(`   Confidence: ${Math.round((result.profile?.confidence ?? 0) * 100)}%`);
  console.log();

  // Coverage (from actual gaps and events)
  console.log(
    chalk.bold(
      `🎯 Event Coverage: ${coverage.percentage}% (${coverage.tracked} tracked / ${coverage.missing} suggested)`
    )
  );
  console.log();

  // Display suggested gaps grouped by signal type
  const signalGroups: Array<{ title: string; key: string; dest: string }> = [
    { title: '📊 Analytics (→ Segment/PostHog):', key: 'action', dest: 'track()' },
    { title: '🔄 State Transitions (→ analytics + logging):', key: 'state_change', dest: 'track() + logger.info()' },
    { title: '🔧 Operations (→ logging):', key: 'operation', dest: 'logger.info()' },
    { title: '🔴 Errors (→ logging + alerts):', key: 'error', dest: 'logger.error()' },
  ];

  const hasSignalTypes = gaps.some((g: any) => g.signalType);
  if (hasSignalTypes) {
    for (const sg of signalGroups) {
      const items = gaps.filter((x: any) => (x.signalType ?? 'action') === sg.key);
      if (items.length === 0) continue;
      console.log(chalk.bold(sg.title));
      for (const gap of (items as typeof gaps).slice(0, 12)) {
        const loc =
          gap.location?.file != null && gap.location?.line != null
            ? `${gap.location.file}:${gap.location.line}`
            : gap.location?.file ?? 'unknown';
        console.log(
          `  ${chalk.yellow('✗')} ${chalk.bold((gap.suggestedEvent ?? '').padEnd(22))} ${chalk.dim(loc)}`
        );
        if (gap.description) console.log(chalk.dim(`                           ${gap.description}`));
        if (gap.includes?.length) {
          console.log(chalk.dim(`                           Includes: ${gap.includes.join(', ')}`));
        }
      }
      if (items.length > 12) console.log(chalk.dim(`  ... and ${items.length - 12} more`));
      console.log();
    }
  } else {
    // Fallback: group by priority
    const groups: Array<{ title: string; key: string }> = [
      { title: 'Critical Events (track these first):', key: 'critical' },
      { title: 'High Priority:', key: 'high' },
      { title: 'Medium Priority:', key: 'medium' },
      { title: 'Low Priority:', key: 'low' },
    ];
    for (const g of groups) {
      const items = gaps.filter((x) => x.priority === g.key);
      if (items.length === 0) continue;
      console.log(chalk.bold(g.title));
      for (const gap of items.slice(0, 12)) {
        const loc =
          gap.location?.file != null && gap.location?.line != null
            ? `${gap.location.file}:${gap.location.line}`
            : gap.location?.file ?? 'unknown';
        const hint = gap.hint ?? '';
        console.log(
          `  ${chalk.yellow('✗')} ${chalk.bold((gap.suggestedEvent ?? '').padEnd(22))} ${loc} ${chalk.dim(hint)}`
        );
        if (gap.description) console.log(chalk.dim(`                           ${gap.description}`));
        if (gap.includes?.length) {
          console.log(chalk.dim(`                           Includes: ${gap.includes.join(', ')}`));
        }
      }
      if (items.length > 12) console.log(chalk.dim(`  ... and ${items.length - 12} more`));
      console.log();
    }
  }

  // Already tracked (from scan result only)
  if (events.length > 0) {
    console.log(chalk.bold('Already Tracked:'));
    for (const ev of events.slice(0, 12)) {
      const first = ev.locations?.[0];
      const loc = first ? `${first.file ?? ''}:${first.line ?? ''}` : '';
      console.log(`  ${chalk.green('✓')} ${chalk.bold((ev.name ?? '').padEnd(22))} ${loc}`);
    }
    if (events.length > 12) console.log(chalk.dim(`  ... and ${events.length - 12} more`));
    console.log();
  }

  // Convention coverage (when conventions apply)
  const conventionCoverage = result.conventionCoverage;
  if (conventionCoverage?.length) {
    for (const cov of conventionCoverage) {
      console.log(chalk.bold(`🎯 Convention Coverage: ${cov.domain}`));
      console.log();
      if (cov.matched.length) {
        console.log(chalk.bold('Matched:'));
        for (const m of cov.matched) {
          console.log(`  ${chalk.green('✓')} ${chalk.bold(m.eventName.padEnd(24))} ${m.location}`);
          if (m.missingRequired.length) {
            console.log(chalk.yellow(`    ⚠ Missing required: ${m.missingRequired.join(', ')}${m.requiredHint ? ` (${m.requiredHint})` : ''}`));
          } else {
            console.log(chalk.dim('    ✓ All required attributes present'));
          }
        }
        console.log();
      }
      if (cov.missing.length) {
        console.log(chalk.bold('Missing:'));
        for (const m of cov.missing) {
          console.log(`  ${chalk.yellow('✗')} ${chalk.bold(m.eventName.padEnd(24))} ${chalk.dim(m.reason)}`);
          if (m.required.length) console.log(chalk.dim(`    Required: ${m.required.join(', ')}`));
        }
        console.log();
      }
    }
  }

  console.log(chalk.dim('Run `logline spec` to update your tracking plan.'));
}

