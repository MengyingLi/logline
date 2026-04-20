import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { createEmptyTrackingPlan, writeTrackingPlan, getTrackingPlanPath } from '../lib/utils/tracking-plan';

function detectSourceDirs(cwd: string): string[] {
  const exts = ['ts', 'tsx', 'js', 'jsx'];
  const candidates = ['src', 'app', 'apps', 'pages', 'lib', 'packages'];
  const found = candidates.filter((d) => fs.existsSync(path.join(cwd, d)));
  if (found.length === 0) {
    // Fallback: scan everything (load-files already ignores node_modules etc.)
    return exts.map((e) => `**/*.${e}`);
  }
  return found.flatMap((d) => exts.map((e) => `${d}/**/*.${e}`));
}

export async function initCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const loglineDir = path.join(cwd, '.logline');
  const configPath = path.join(loglineDir, 'config.json');
  const planPath = getTrackingPlanPath(cwd);
  const gitignorePath = path.join(loglineDir, '.gitignore');

  // 1. Create .logline/ directory
  fs.mkdirSync(loglineDir, { recursive: true });

  // 2. Create config.json if it doesn't exist (don't overwrite)
  if (!fs.existsSync(configPath)) {
    const include = detectSourceDirs(cwd);
    const defaultConfig = {
      eventGranularity: 'business',
      tracking: {
        destination: 'custom',
        importPath: '@/lib/analytics',
        functionName: 'track',
      },
      scan: {
        include,
        exclude: ['**/*.test.*', '**/*.spec.*', '**/node_modules/**'],
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
    console.log(`  ${chalk.green('✓')} Created .logline/config.json`);
  } else {
    console.log(`  ${chalk.dim('→')} .logline/config.json already exists, skipping`);
  }

  // 3. Create tracking-plan.json if it doesn't exist
  if (!fs.existsSync(planPath)) {
    writeTrackingPlan(cwd, createEmptyTrackingPlan());
    console.log(`  ${chalk.green('✓')} Created .logline/tracking-plan.json`);
  } else {
    console.log(`  ${chalk.dim('→')} .logline/tracking-plan.json already exists, skipping`);
  }

  // 4. Create .logline/.gitignore to ignore cache but NOT tracking plan or config
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, 'cache/\n');
    console.log(`  ${chalk.green('✓')} Created .logline/.gitignore (ignores cache/)`);
  }

  // 5. Print next steps
  console.log();
  console.log(chalk.bold('Logline initialized! Next steps:'));
  console.log();
  console.log(`  1. Run ${chalk.cyan('logline scan')} to analyze your codebase`);
  console.log(`  2. Run ${chalk.cyan('logline spec')} to generate your tracking plan`);
  console.log(`  3. Review .logline/tracking-plan.json and approve events`);
  console.log(`  4. Run ${chalk.cyan('logline pr --dry-run')} to preview instrumentation`);
  console.log();
  console.log(chalk.dim('Commit .logline/config.json and .logline/tracking-plan.json to your repo.'));
  console.log(chalk.dim('The cache/ directory is auto-ignored by git.'));
}
