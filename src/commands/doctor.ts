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
  warn?: boolean; // true = yellow warning, not a hard failure
}

async function pingIngest(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch('https://logline.dev/api/v1/events/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ event: '__doctor_ping__', properties: {} }),
      signal: AbortSignal.timeout(4000),
    });
    // 200 = ok, 400/401 = reachable but key may be invalid — both mean the endpoint is up
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function doctorCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const checks: CheckResult[] = [];

  // ── Node version ─────────────────────────────────────────────────────────
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace('v', '').split('.')[0] ?? '0', 10);
  checks.push({
    label: 'Node.js version',
    ok: nodeMajor >= 18,
    value: nodeVersion,
    hint: nodeMajor < 18 ? 'Logline requires Node.js 18 or later' : undefined,
  });

  // ── OpenAI key ───────────────────────────────────────────────────────────
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  checks.push({
    label: 'OPENAI_API_KEY',
    ok: true, // optional — warn, not fail
    warn: !hasOpenAI,
    value: hasOpenAI ? `set (${process.env.OPENAI_API_KEY?.slice(0, 7)}…)` : 'not set',
    hint: hasOpenAI ? undefined : 'Optional. Set for smart event detection. Use --fast for regex-only mode.',
  });

  // ── git ──────────────────────────────────────────────────────────────────
  let gitOk = false, gitValue = 'not found';
  try { gitValue = execSync('git --version', { encoding: 'utf8' }).trim().replace('git version ', ''); gitOk = true; } catch {}
  checks.push({ label: 'git', ok: gitOk, value: gitValue, hint: gitOk ? undefined : 'git is required for `logline pr`' });

  // ── gh CLI ───────────────────────────────────────────────────────────────
  let ghOk = false, ghValue = 'not found';
  try { ghValue = execSync('gh --version', { encoding: 'utf8' }).split('\n')[0]?.trim() ?? 'found'; ghOk = true; } catch {}
  checks.push({ label: 'gh CLI', ok: ghOk, value: ghValue, warn: !ghOk, hint: ghOk ? undefined : 'Optional. Install GitHub CLI (gh) to use `logline pr`' });

  // ── git repo ─────────────────────────────────────────────────────────────
  let isGitRepo = false;
  try { execSync('git rev-parse --git-dir', { cwd, encoding: 'utf8', stdio: 'pipe' }); isGitRepo = true; } catch {}
  checks.push({
    label: 'Git repository',
    ok: isGitRepo,
    value: isGitRepo ? cwd : 'not a git repo',
    hint: isGitRepo ? undefined : 'Run `git init` to initialize a repository here',
  });

  // ── .logline/ ────────────────────────────────────────────────────────────
  const loglineDir = path.join(cwd, '.logline');
  const hasLoglineDir = fs.existsSync(loglineDir);
  checks.push({
    label: '.logline/ directory',
    ok: hasLoglineDir,
    value: hasLoglineDir ? 'found' : 'not found',
    hint: hasLoglineDir ? undefined : 'Run `logline init` to initialize Logline in this project',
  });

  // ── tracking-plan.json ───────────────────────────────────────────────────
  const planPath = getTrackingPlanPath(cwd);
  const hasPlan = fs.existsSync(planPath);
  checks.push({
    label: 'tracking-plan.json',
    ok: hasPlan,
    value: hasPlan ? path.relative(cwd, planPath) : 'not found',
    hint: hasPlan ? undefined : 'Run `logline spec` to generate your tracking plan',
  });

  // ── Logline track.ts + API key ───────────────────────────────────────────
  const trackPath = path.join(loglineDir, 'track.ts');
  const hasTrackFile = fs.existsSync(trackPath);

  if (hasTrackFile) {
    const trackContent = fs.readFileSync(trackPath, 'utf8');
    // Extract the API key from the file
    const keyMatch = trackContent.match(/['"](lk_[a-f0-9]+)['"]/);
    const isPlaceholder = trackContent.includes('lk_your_key_here');
    const envFallback = trackContent.includes('process.env.LOGLINE_API_KEY');

    if (keyMatch && !isPlaceholder) {
      const key = keyMatch[1];
      // Ping the endpoint to verify
      const reachable = await pingIngest(key);
      checks.push({
        label: 'Logline API key',
        ok: reachable,
        value: reachable
          ? `${key.slice(0, 10)}… (verified ✓)`
          : `${key.slice(0, 10)}… (endpoint unreachable)`,
        hint: reachable ? undefined : 'Check your API key at logline.dev/dashboard',
      });
    } else if (envFallback) {
      const envKey = process.env.LOGLINE_API_KEY;
      const hasEnvKey = Boolean(envKey) && !envKey?.includes('your_key_here');
      checks.push({
        label: 'LOGLINE_API_KEY',
        ok: hasEnvKey,
        warn: !hasEnvKey,
        value: hasEnvKey ? `set (${envKey?.slice(0, 10)}…)` : 'not set (using placeholder)',
        hint: hasEnvKey ? undefined : 'Set LOGLINE_API_KEY env var or paste your key into .logline/track.ts',
      });
    } else if (isPlaceholder) {
      checks.push({
        label: 'Logline API key',
        ok: false,
        warn: true,
        value: 'placeholder (lk_your_key_here)',
        hint: 'Replace the placeholder in .logline/track.ts with your real key from logline.dev',
      });
    }
  } else if (hasLoglineDir) {
    checks.push({
      label: '.logline/track.ts',
      ok: false,
      warn: true,
      value: 'not found',
      hint: 'Run `logline init` to create .logline/track.ts with your API key',
    });
  }

  // ── Source files ─────────────────────────────────────────────────────────
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

  // ── Print results ─────────────────────────────────────────────────────────
  console.log();
  console.log(chalk.bold('  Logline Doctor'));
  console.log();

  for (const c of checks) {
    const icon = c.ok
      ? chalk.green('✓')
      : c.warn
      ? chalk.yellow('⚠')
      : chalk.red('✗');
    const label = c.label.padEnd(22);
    const value = c.value ? chalk.dim(c.value) : '';
    console.log(`  ${icon} ${label} ${value}`);
    if ((!c.ok || c.warn) && c.hint) {
      console.log(`    ${chalk.yellow('→')} ${chalk.dim(c.hint)}`);
    }
  }

  console.log();

  const hardFailed = checks.filter((c) => !c.ok && !c.warn);
  const warned = checks.filter((c) => c.warn);

  if (hardFailed.length === 0 && warned.length === 0) {
    console.log(chalk.green("  All checks passed. You're good to go!"));
  } else if (hardFailed.length === 0) {
    console.log(chalk.yellow(`  ${warned.length} warning${warned.length !== 1 ? 's' : ''} — optional items not configured.`));
  } else {
    console.log(chalk.red(`  ${hardFailed.length} check${hardFailed.length !== 1 ? 's' : ''} failed.`) + chalk.dim(' Fix the issues above and re-run.'));
  }
  console.log();
}
