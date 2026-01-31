#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { scanCommand } from './commands/scan';
import { specAllCommand } from './commands/spec';
import { prCommand } from './commands/pr';

const program = new Command();

program.name('logline').description('Logline').version('0.1.0');

program
  .command('scan')
  .description('Analyze product + tracking coverage + suggested events')
  .option('--fast', 'Skip LLM product reasoning')
  .option('--deep', 'Use deeper (slower) analysis where available')
  .option('--granular', 'Show all granular interactions (no business-event grouping)')
  .action(async (opts) => {
    console.log(chalk.bold('\n🔬 Analyzing your product...\n'));

    const result = await scanCommand({
      fast: Boolean(opts.fast),
      deep: Boolean(opts.deep),
      granular: Boolean(opts.granular),
    });
    printScanResult(result);
  });

program
  .command('spec')
  .argument('[type]', 'Type of spec to generate', 'all')
  .description('Generate event specifications')
  .action(async (type) => {
    if (type === 'all') {
      await specAllCommand({});
    }
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

  // Display suggested gaps by priority (from scan result only)
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
      const isGrouped = gap.description != null || (gap.includes != null && gap.includes.length > 0);
      console.log(
        `  ${chalk.yellow('✗')} ${chalk.bold((gap.suggestedEvent ?? '').padEnd(22))} ${loc} ${chalk.dim(hint)}`
      );
      if (isGrouped) {
        if (gap.description) console.log(chalk.dim(`                           ${gap.description}`));
        if (gap.includes?.length) {
          console.log(chalk.dim(`                           Includes: ${gap.includes.join(', ')}`));
        }
      }
    }
    if (items.length > 12) console.log(chalk.dim(`  ... and ${items.length - 12} more`));
    console.log();
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

  console.log(chalk.dim('Run `logline spec all` to generate specs for missing events.'));
}

