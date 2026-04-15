import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { getTrackingPlanPath } from '../lib/utils/tracking-plan';

interface CheckResult {
  label: string;
  ok: boolean;
  value?: string;
  hint?: string;
}

export async function doctorCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const checks: CheckResult[] = [];

  // Node version
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace('v', '').split('.')[0] ?? '0', 10);
  checks.push({
    label: 'Node.js version',
    ok: nodeMajor >= 18,
    value: nodeVersion,
    hint: nodeMajor < 18 ? 'Logline requires Node.js 18 or later' : undefined,
  });

  // OpenAI API key
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  checks.push({
    label: 'OPENAI_API_KEY',
    ok: hasKey,
    value: hasKey ? `set (${process.env.OPENAI_API_KEY?.slice(0, 7)}...)` : 'not set',
    hint: hasKey ? undefined : 'Set OPENAI_API_KEY for smart detection. Use --fast for regex-only mode.',
  });

  // Git
  let gitOk = false;
  let gitValue = 'not found';
  try {
    gitValue = execSync('git --version', { encoding: 'utf8' }).trim().replace('git version ', '');
    gitOk = true;
  } catch {}
  checks.push({ label: 'git', ok: gitOk, value: gitValue, hint: gitOk ? undefined : 'git is required for the `logline pr` command' });

  // gh CLI
  let ghOk = false;
  let ghValue = 'not found';
  try {
    ghValue = execSync('gh --version', { encoding: 'utf8' }).split('\n')[0]?.trim() ?? 'found';
    ghOk = true;
  } catch {}
  checks.push({ label: 'gh CLI', ok: ghOk, value: ghValue, hint: ghOk ? undefined : 'Install the GitHub CLI (gh) to use `logline pr`' });

  // Is a git repo?
  let isGitRepo = false;
  try {
    execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: 'pipe' });
    isGitRepo = true;
  } catch {}
  checks.push({
    label: 'Git repository',
    ok: isGitRepo,
    value: isGitRepo ? cwd : 'not a git repo',
    hint: isGitRepo ? undefined : 'Run `git init` to initialize a repository here',
  });

  // .logline/ initialized?
  const loglineDir = path.join(cwd, '.logline');
  const hasLoglineDir = fs.existsSync(loglineDir);
  checks.push({
    label: '.logline/ directory',
    ok: hasLoglineDir,
    value: hasLoglineDir ? 'found' : 'not found',
    hint: hasLoglineDir ? undefined : 'Run `logline init` to initialize Logline in this project',
  });

  // tracking-plan.json exists?
  const planPath = getTrackingPlanPath(cwd);
  const hasPlan = fs.existsSync(planPath);
  checks.push({
    label: 'tracking-plan.json',
    ok: hasPlan,
    value: hasPlan ? path.relative(cwd, planPath) : 'not found',
    hint: hasPlan ? undefined : 'Run `logline spec` to generate your tracking plan',
  });

  // Source files detected?
  let srcCount = 0;
  try {
    const walk = (dir: string, depth = 0): void => {
      if (depth > 4) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, depth + 1); continue; }
        if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) srcCount++;
      }
    };
    walk(cwd);
  } catch {}
  checks.push({
    label: 'Source files',
    ok: srcCount > 0,
    value: srcCount > 0 ? `${srcCount} .ts/.tsx/.js/.jsx files found` : 'none found',
    hint: srcCount === 0 ? 'Run logline from a directory with TypeScript or JavaScript source files' : undefined,
  });

  // Print results
  console.log();
  console.log(chalk.bold('  Logline Doctor'));
  console.log();

  for (const c of checks) {
    const icon = c.ok ? chalk.green('✓') : chalk.red('✗');
    const label = c.label.padEnd(22);
    const value = c.value ? chalk.dim(c.value) : '';
    console.log(`  ${icon} ${label} ${value}`);
    if (!c.ok && c.hint) {
      console.log(`    ${chalk.yellow('→')} ${chalk.dim(c.hint)}`);
    }
  }

  console.log();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length === 0) {
    console.log(chalk.green('  All checks passed. You\'re good to go!'));
  } else {
    console.log(chalk.yellow(`  ${failed.length} check${failed.length !== 1 ? 's' : ''} failed. Fix the issues above and re-run.`));
  }
  console.log();
}
