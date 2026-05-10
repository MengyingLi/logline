import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import chalk from 'chalk';
import { createEmptyTrackingPlan, writeTrackingPlan, getTrackingPlanPath } from '../lib/utils/tracking-plan';

// ─── Destination options ──────────────────────────────────────────────────────

interface DestinationChoice {
  label: string;
  destination: string;
  importPath: string;
  functionName: string;
  needsApiKey: boolean;
}

const DESTINATIONS: DestinationChoice[] = [
  { label: 'Logline Cloud (recommended)', destination: 'logline',   importPath: '.logline/track',                      functionName: 'track',   needsApiKey: true  },
  { label: 'Segment',                     destination: 'segment',   importPath: '@/lib/analytics',                     functionName: 'track',   needsApiKey: false },
  { label: 'PostHog',                     destination: 'posthog',   importPath: '@/lib/analytics',                     functionName: 'capture', needsApiKey: false },
  { label: 'Mixpanel',                    destination: 'mixpanel',  importPath: '@/lib/analytics',                     functionName: 'track',   needsApiKey: false },
  { label: 'Amplitude',                   destination: 'amplitude', importPath: '@/lib/analytics',                     functionName: 'track',   needsApiKey: false },
  { label: 'Custom / configure later',    destination: 'custom',    importPath: '@/lib/analytics',                     functionName: 'track',   needsApiKey: false },
];

interface SetupAnswers {
  destination: DestinationChoice;
  apiKey: string;
  websiteUrl: string;
  description: string;
}

// ─── Interactive prompts ──────────────────────────────────────────────────────

async function runInteractiveSetup(): Promise<SetupAnswers> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, (a) => resolve(a.trim())));

  try {
    console.log(`  Where do you send analytics events?`);
    DESTINATIONS.forEach((d, i) => {
      console.log(`    ${chalk.dim((i + 1) + '.')} ${d.label}`);
    });
    console.log();

    const destAnswer = await ask(`  ${chalk.cyan('→')} `);
    const destIdx = parseInt(destAnswer, 10) - 1;
    const chosen = DESTINATIONS[destIdx >= 0 && destIdx < DESTINATIONS.length ? destIdx : 0];
    console.log();

    let apiKey = '';
    if (chosen.needsApiKey) {
      const keyAnswer = await ask(
        `  Logline API key ${chalk.dim('(press Enter to add later)')} → `
      );
      if (keyAnswer.startsWith('lk_')) {
        apiKey = keyAnswer;
      } else if (keyAnswer) {
        console.log(chalk.dim('  (key must start with lk_ — skipping for now)'));
      }
      console.log();
    }

    // ── Product context (optional) ───────────────────────────────────────────
    console.log(chalk.dim('  Help Logline understand your product (improves event quality):'));
    console.log();

    const websiteUrl = await ask(`  Website URL ${chalk.dim('(e.g. https://yourapp.com, or press Enter to skip)')} → `);
    const description = await ask(`  One-line description ${chalk.dim('(or press Enter to skip)')} → `);
    console.log();

    return { destination: chosen, apiKey, websiteUrl, description };
  } finally {
    rl.close();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function distributeSkillFile(cwd: string): void {
  const skillSrc = path.join(__dirname, '../../skills/SKILL.md');
  if (!fs.existsSync(skillSrc)) return;
  const skillContent = fs.readFileSync(skillSrc, 'utf8');

  const claudeSkillPath = path.join(cwd, '.claude/skills/logline.md');
  const cursorRulePath = path.join(cwd, '.cursor/rules/logline.mdc');
  const windsurfRulePath = path.join(cwd, '.windsurf/rules/logline.md');

  const hasCursor = fs.existsSync(path.join(cwd, '.cursor')) || fs.existsSync(path.join(cwd, '.cursorrules'));
  const hasWindsurf = fs.existsSync(path.join(cwd, '.windsurf')) || fs.existsSync(path.join(cwd, '.windsurfrules'));

  const alreadyExists =
    fs.existsSync(claudeSkillPath) ||
    (hasCursor && fs.existsSync(cursorRulePath)) ||
    (hasWindsurf && fs.existsSync(windsurfRulePath));

  if (alreadyExists) {
    console.log(`  ${chalk.green('✓')} AI assistant skills already configured`);
    return;
  }

  fs.mkdirSync(path.dirname(claudeSkillPath), { recursive: true });
  fs.writeFileSync(claudeSkillPath, skillContent);
  console.log(`  ${chalk.green('✓')} Created .claude/skills/logline.md`);

  if (hasCursor) {
    fs.mkdirSync(path.dirname(cursorRulePath), { recursive: true });
    fs.writeFileSync(cursorRulePath, skillContent);
    console.log(`  ${chalk.green('✓')} Created .cursor/rules/logline.mdc`);
  }

  if (hasWindsurf) {
    fs.mkdirSync(path.dirname(windsurfRulePath), { recursive: true });
    fs.writeFileSync(windsurfRulePath, skillContent);
    console.log(`  ${chalk.green('✓')} Created .windsurf/rules/logline.md`);
  }
}

function detectSourceDirs(cwd: string): string[] {
  const exts = ['ts', 'tsx', 'js', 'jsx'];
  const candidates = ['src', 'app', 'apps', 'pages', 'lib', 'packages'];
  const found = candidates.filter((d) => fs.existsSync(path.join(cwd, d)));
  if (found.length === 0) return exts.map((e) => `**/*.${e}`);
  return found.flatMap((d) => exts.map((e) => `${d}/**/*.${e}`));
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function initCommand(options: { cwd?: string }): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const loglineDir = path.join(cwd, '.logline');
  const configPath = path.join(loglineDir, 'config.json');
  const planPath = getTrackingPlanPath(cwd);
  const gitignorePath = path.join(loglineDir, '.gitignore');

  // 1. Create .logline/ directory
  fs.mkdirSync(loglineDir, { recursive: true });

  // 2. Config — ask interactively on first run (TTY only)
  const isFirstRun = !fs.existsSync(configPath);
  let trackingDest = { destination: 'logline', importPath: '.logline/track', functionName: 'track' };
  let apiKey = '';

  let productContext: { websiteUrl?: string; description?: string } = {};

  if (isFirstRun && process.stdin.isTTY) {
    const answers = await runInteractiveSetup();
    trackingDest = {
      destination: answers.destination.destination,
      importPath: answers.destination.importPath,
      functionName: answers.destination.functionName,
    };
    apiKey = answers.apiKey;
    if (answers.websiteUrl) productContext.websiteUrl = answers.websiteUrl;
    if (answers.description) productContext.description = answers.description;
  }

  if (isFirstRun) {
    const include = detectSourceDirs(cwd);
    const config: Record<string, unknown> = {
      eventGranularity: 'business',
      tracking: trackingDest,
      scan: {
        include,
        exclude: [
          '**/*.test.*', '**/*.spec.*', '**/*.stories.*',
          '**/node_modules/**', '**/__tests__/**', '**/__mocks__/**',
          '**/fixtures/**', '**/test-utils/**',
          '**/scripts/**', '**/migrations/**', '**/seed.*', '**/seed/**',
          '**/playwright/**', '**/e2e/**', '**/cypress/**',
          '**/cron/**', '**/jobs/**', '**/workers/**', '**/queues/**',
          '**/tasks/**', '**/scheduler/**',
        ],
      },
    };
    if (productContext.websiteUrl || productContext.description) {
      config.product = productContext;
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log(`  ${chalk.green('✓')} Created .logline/config.json`);
  } else {
    console.log(`  ${chalk.dim('→')} .logline/config.json already exists, skipping`);
  }

  // 3. Tracking plan
  if (!fs.existsSync(planPath)) {
    writeTrackingPlan(cwd, createEmptyTrackingPlan());
    console.log(`  ${chalk.green('✓')} Created .logline/tracking-plan.json`);
  } else {
    console.log(`  ${chalk.dim('→')} .logline/tracking-plan.json already exists, skipping`);
  }

  // 4. .gitignore
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, 'cache/\n');
    console.log(`  ${chalk.green('✓')} Created .logline/.gitignore (ignores cache/)`);
  }

  // 5. .logline/track.ts — only for Logline Cloud destination
  if (trackingDest.importPath === '.logline/track') {
    const trackPath = path.join(loglineDir, 'track.ts');
    if (!fs.existsSync(trackPath)) {
      const keyValue = apiKey || 'lk_your_key_here';
      const trackContent = [
        `import { init, track } from 'logline-cli/sdk';`,
        ``,
        `init({ apiKey: process.env.LOGLINE_API_KEY ?? '${keyValue}' });`,
        ``,
        `export { track };`,
        ``,
      ].join('\n');
      fs.writeFileSync(trackPath, trackContent);
      console.log(`  ${chalk.green('✓')} Created .logline/track.ts — ${chalk.cyan("import { track } from './.logline/track'")}`);
    } else {
      // Update the API key in an existing track.ts if user provided one now
      if (apiKey) {
        let content = fs.readFileSync(trackPath, 'utf8');
        content = content.replace(/lk_your_key_here/, apiKey);
        fs.writeFileSync(trackPath, content);
        console.log(`  ${chalk.green('✓')} Updated .logline/track.ts with API key`);
      } else {
        console.log(`  ${chalk.dim('→')} .logline/track.ts already exists, skipping`);
      }
    }
  }

  // 6. AI assistant skill files
  distributeSkillFile(cwd);

  // 7. Next steps
  console.log();
  console.log(chalk.bold('Logline initialized! Next steps:'));
  console.log();
  console.log(`  1. Run ${chalk.cyan('logline scan')} to analyze your codebase`);
  console.log(`  2. Run ${chalk.cyan('logline spec')} to generate your tracking plan`);
  console.log(`  3. Review .logline/tracking-plan.json and approve events`);
  console.log(`  4. Run ${chalk.cyan('logline apply')} to instrument your code`);
  console.log();
  console.log(chalk.dim('Commit .logline/config.json and .logline/tracking-plan.json to your repo.'));
  console.log(chalk.dim('The cache/ directory is auto-ignored by git.'));
}
