#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import pkg from '../package.json';
import { checkForUpdates } from './lib/utils/update-check';
import { coverageBar, priorityLabel, trunc } from './lib/utils/format';
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
import { applyCommand } from './commands/apply';
import { lintCommand } from './commands/lint';
import { execSync } from 'child_process';

// ─── Shell completion scripts ─────────────────────────────────────────────────
// Defined here (before command registrations) to avoid temporal dead zone.

const _CMDS = 'init scan spec apply approve reject lint status pr doctor open export metrics context completion';
const _SCAN_FLAGS = '--fast --deep --json --verbose --granular';
const _EXPORT_FMTS = 'segment amplitude opentelemetry glassflow';

const ZSH_COMPLETION = `\
#compdef logline

_logline() {
  local -a commands
  commands=(
    'init:Initialize .logline/ in your project'
    'scan:Detect missing analytics events'
    'spec:Generate or update the tracking plan'
    'apply:Interactively instrument suggested events'
    'approve:Review and approve suggested events'
    'reject:Mark events as deprecated'
    'lint:Validate track() calls against the tracking plan'
    'status:Show tracking plan summary'
    'pr:Create a PR with analytics instrumentation'
    'doctor:Check environment and configuration'
    'open:Open the Logline dashboard in your browser'
    'export:Export tracking plan to external tools'
    'metrics:Generate metric definitions'
    'context:Show product ontology'
    'completion:Print shell completion script'
  )

  case $CURRENT in
    2) _describe 'command' commands ;;
    *)
      case $words[2] in
        scan)       _arguments '${_SCAN_FLAGS.split(' ').join("' '")}' ;;
        approve)    _arguments '--all' '--interactive' ;;
        reject)     _arguments '--all' ;;
        lint)       _arguments '--json' ;;
        export)     _arguments '--format[Format]:format:(${_EXPORT_FMTS})' '--output[Output file]:file:_files' ;;
        pr)         _arguments '--dry-run' '--base[Base branch]:branch:' '--title[PR title]:title:' ;;
        completion) _arguments '--shell[Shell type]:shell:(zsh bash fish)' ;;
      esac
  esac
}

_logline "$@"`;

const BASH_COMPLETION = `\
_logline_completion() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local cmd="\${COMP_WORDS[1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=(\$(compgen -W "${_CMDS}" -- "\$cur"))
  else
    case "\$cmd" in
      scan)       COMPREPLY=(\$(compgen -W "${_SCAN_FLAGS}" -- "\$cur")) ;;
      approve)    COMPREPLY=(\$(compgen -W "--all --interactive" -- "\$cur")) ;;
      lint)       COMPREPLY=(\$(compgen -W "--json" -- "\$cur")) ;;
      export)     COMPREPLY=(\$(compgen -W "--format --output ${_EXPORT_FMTS}" -- "\$cur")) ;;
      pr)         COMPREPLY=(\$(compgen -W "--dry-run --base --title" -- "\$cur")) ;;
      completion) COMPREPLY=(\$(compgen -W "--shell zsh bash fish" -- "\$cur")) ;;
    esac
  fi
}

complete -F _logline_completion logline`;

const FISH_COMPLETION = `\
function __fish_logline_no_subcommand
  not string match -qr '\\b(${_CMDS.split(' ').join('|')})\\b' -- (commandline -poc)
end

complete -c logline -f
complete -c logline -n '__fish_logline_no_subcommand' -a 'init'       -d 'Initialize .logline/'
complete -c logline -n '__fish_logline_no_subcommand' -a 'scan'       -d 'Detect missing events'
complete -c logline -n '__fish_logline_no_subcommand' -a 'spec'       -d 'Generate tracking plan'
complete -c logline -n '__fish_logline_no_subcommand' -a 'apply'      -d 'Instrument suggested events'
complete -c logline -n '__fish_logline_no_subcommand' -a 'approve'    -d 'Approve suggested events'
complete -c logline -n '__fish_logline_no_subcommand' -a 'reject'     -d 'Deprecate events'
complete -c logline -n '__fish_logline_no_subcommand' -a 'lint'       -d 'Validate track() calls'
complete -c logline -n '__fish_logline_no_subcommand' -a 'status'     -d 'Show tracking plan summary'
complete -c logline -n '__fish_logline_no_subcommand' -a 'pr'         -d 'Create instrumentation PR'
complete -c logline -n '__fish_logline_no_subcommand' -a 'doctor'     -d 'Check environment'
complete -c logline -n '__fish_logline_no_subcommand' -a 'open'       -d 'Open Logline dashboard'
complete -c logline -n '__fish_logline_no_subcommand' -a 'export'     -d 'Export to external tools'
complete -c logline -n '__fish_logline_no_subcommand' -a 'metrics'    -d 'Generate metric definitions'
complete -c logline -n '__fish_logline_no_subcommand' -a 'context'    -d 'Show product ontology'
complete -c logline -n '__fish_logline_no_subcommand' -a 'completion' -d 'Print completion script'
complete -c logline -n '__fish_seen_subcommand_from scan'     -l fast      -d 'Skip LLM'
complete -c logline -n '__fish_seen_subcommand_from scan'     -l deep      -d 'Deeper analysis'
complete -c logline -n '__fish_seen_subcommand_from scan'     -l json      -d 'JSON output'
complete -c logline -n '__fish_seen_subcommand_from scan'     -l verbose   -d 'Verbose output'
complete -c logline -n '__fish_seen_subcommand_from scan'     -l granular  -d 'All interactions'
complete -c logline -n '__fish_seen_subcommand_from approve'  -l all       -d 'Approve all'
complete -c logline -n '__fish_seen_subcommand_from approve'  -s i -l interactive -d 'Interactive'
complete -c logline -n '__fish_seen_subcommand_from lint'     -l json      -d 'JSON output'
complete -c logline -n '__fish_seen_subcommand_from export'   -l format    -d 'Output format' -r -a '${_EXPORT_FMTS}'
complete -c logline -n '__fish_seen_subcommand_from pr'       -l dry-run   -d 'Preview only'`;

// ─── Program ──────────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('logline')
  .description('Logline — semantic layer for product analytics. Generates tracking plans from codebases.')
  .version(pkg.version);

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
  .description('Review and approve suggested events (interactive by default)')
  .option('--cwd <cwd>', 'Working directory')
  .option('--all', 'Approve all suggested events non-interactively')
  .option('-i, --interactive', 'Force interactive mode')
  .action(async (eventName: string | undefined, opts: any) => {
    await approveCommand({
      cwd: opts.cwd ? String(opts.cwd) : undefined,
      eventName: eventName ? String(eventName) : undefined,
      all: Boolean(opts.all),
      interactive: Boolean(opts.interactive),
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
  .command('apply [eventName]')
  .description('Interactively apply suggested analytics events to source files')
  .option('--cwd <cwd>', 'Working directory')
  .action(async (eventName: string | undefined, opts: { cwd?: string }) => {
    await applyCommand({ cwd: opts.cwd, eventName });
  });

program
  .command('doctor')
  .description('Check environment (Node version, API key, git, gh CLI, tracking plan)')
  .option('--cwd <cwd>', 'Working directory')
  .action(async (opts) => {
    await doctorCommand({ cwd: opts.cwd ? String(opts.cwd) : undefined });
  });

program
  .command('lint')
  .description('Validate track() calls in source files against the tracking plan')
  .option('--cwd <cwd>', 'Working directory')
  .option('--json', 'Machine-readable output')
  .action(async (opts) => {
    await lintCommand({ cwd: opts.cwd ? String(opts.cwd) : undefined, json: Boolean(opts.json) });
  });

program
  .command('open')
  .description('Open the Logline dashboard in your browser')
  .action(() => {
    const url = 'https://logline.dev/dashboard';
    const opener =
      process.platform === 'darwin' ? 'open' :
      process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      execSync(`${opener} "${url}"`, { stdio: 'ignore' });
      console.log(chalk.dim(`Opening ${url}`));
    } catch {
      console.log(`Open: ${url}`);
    }
  });

program
  .command('completion')
  .description('Print shell completion script')
  .option('--shell <shell>', 'Shell type: zsh | bash | fish', 'zsh')
  .action((opts) => {
    const shell = String(opts.shell).toLowerCase();
    if (shell === 'zsh') {
      process.stdout.write(ZSH_COMPLETION + '\n');
      process.stderr.write(chalk.dim('\n# Add to ~/.zshrc:\n#   eval "$(logline completion --shell zsh)"\n# Or for faster startup:\n#   logline completion --shell zsh > ~/.zfunc/_logline\n#   fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit\n'));
    } else if (shell === 'bash') {
      process.stdout.write(BASH_COMPLETION + '\n');
      process.stderr.write(chalk.dim('\n# Add to ~/.bashrc or ~/.bash_profile:\n#   eval "$(logline completion --shell bash)"\n'));
    } else if (shell === 'fish') {
      process.stdout.write(FISH_COMPLETION + '\n');
      process.stderr.write(chalk.dim('\n# Save to fish completions:\n#   logline completion --shell fish > ~/.config/fish/completions/logline.fish\n'));
    } else {
      console.error(chalk.red(`Unknown shell: ${shell}. Use --shell zsh|bash|fish`));
      process.exit(1);
    }
  });

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Start update check early (non-blocking, returns from cache instantly)
  const updatePromise = checkForUpdates(pkg.version);

  await program.parseAsync();

  // Print update notice after the command (max 300 ms wait, stderr so --json is clean)
  try {
    const latest = await Promise.race([
      updatePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    if (latest) {
      process.stderr.write(
        chalk.dim(`\n  ℹ  logline-cli ${chalk.bold(latest)} is available (you have ${pkg.version})\n`) +
        chalk.dim(`     npm i -g logline-cli\n`)
      );
    }
  } catch {}
}

main();

// ─── Scan output ──────────────────────────────────────────────────────────────

function printScanResult(result: Awaited<ReturnType<typeof scanCommand>>): void {
  const gaps = Array.isArray(result.gaps) ? result.gaps : [];
  const events = Array.isArray(result.events) ? result.events : [];
  const coverage = result.coverage ?? { tracked: events.length, missing: gaps.length, percentage: 0 };

  const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];

  // ── Gaps table ─────────────────────────────────────────────────────────────
  if (gaps.length > 0) {
    const sorted = [...gaps].sort(
      (a, b) => PRIORITY_ORDER.indexOf(a.priority ?? 'low') - PRIORITY_ORDER.indexOf(b.priority ?? 'low')
    );
    const shown = sorted.slice(0, 20);
    const rest = sorted.length - shown.length;

    console.log(chalk.bold(`Gaps — ${gaps.length} event${gaps.length === 1 ? '' : 's'} to instrument`));
    console.log();

    for (const gap of shown) {
      const name = trunc(gap.suggestedEvent ?? '', 32);
      const file = gap.location?.file
        ? `${gap.location.file}${gap.location.line ? `:${gap.location.line}` : ''}`
        : '';
      const loc = chalk.dim(trunc(file, 38));
      const pri = priorityLabel(gap.priority);
      console.log(`  ${chalk.yellow('✗')} ${name}  ${loc}  ${pri}`);
      if (gap.includes?.length) {
        console.log(chalk.dim(`       Includes: ${gap.includes.join(', ')}`));
      }
    }

    if (rest > 0) console.log(chalk.dim(`  … and ${rest} more`));
    console.log();
  } else {
    console.log(`${chalk.green('✓')} No gaps — your tracking looks complete!`);
    console.log();
  }

  // ── Already tracked (inline, compact) ─────────────────────────────────────
  if (events.length > 0) {
    const names = events
      .slice(0, 6)
      .map((e) => chalk.dim(e.name))
      .join(chalk.dim(' · '));
    const extra = events.length > 6 ? chalk.dim(` and ${events.length - 6} more`) : '';
    console.log(`${chalk.green('✓')} Tracking: ${names}${extra}`);
    console.log();
  }

  // ── Coverage bar ───────────────────────────────────────────────────────────
  const pct = coverage.percentage;
  const bar = coverageBar(pct);
  console.log(`Coverage  ${bar}  ${chalk.bold(`${pct}%`)}  ${chalk.dim(`${coverage.tracked} tracked · ${coverage.missing} gaps`)}`);

  if (gaps.length > 0) {
    console.log();
    console.log(chalk.dim('Run `logline spec` to save to tracking plan, then `logline apply` to instrument.'));
  }

  // ── Convention coverage (unchanged, only shown when conventions apply) ─────
  const conventionCoverage = result.conventionCoverage;
  if (conventionCoverage?.length) {
    console.log();
    for (const cov of conventionCoverage) {
      console.log(chalk.bold(`Convention Coverage — ${cov.domain}`));
      console.log();
      if (cov.matched.length) {
        for (const m of cov.matched) {
          console.log(`  ${chalk.green('✓')} ${chalk.bold(m.eventName.padEnd(24))} ${chalk.dim(m.location)}`);
          if (m.missingRequired.length) {
            console.log(chalk.yellow(`    ⚠ Missing required: ${m.missingRequired.join(', ')}${m.requiredHint ? ` (${m.requiredHint})` : ''}`));
          }
        }
        console.log();
      }
      if (cov.missing.length) {
        for (const m of cov.missing) {
          console.log(`  ${chalk.yellow('✗')} ${chalk.bold(m.eventName.padEnd(24))} ${chalk.dim(m.reason)}`);
          if (m.required.length) console.log(chalk.dim(`    Required: ${m.required.join(', ')}`));
        }
        console.log();
      }
    }
  }
}

