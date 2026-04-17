import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';
import chalk from 'chalk';
import { scanCommand } from './scan';
import type { ScanResult } from './scan';
import type { DetectedEvent } from '../lib/types';
import { generateTrackingCode } from '../lib/utils/code-generator';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';
import { readTrackingPlan, writeTrackingPlan } from '../lib/utils/tracking-plan';
import { readLoglineConfig, type LoglineConfig } from '../lib/utils/config';

const IGNORED_EVENTS = [
  'sidebar_interacted',
  'sidebar_toggled',
  'menu_opened',
  'menu_closed',
  'key_pressed',
];

interface PROptions {
  cwd?: string;
  dryRun?: boolean;
  title?: string;
  baseBranch?: string;
}

export async function prCommand(options: PROptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const config = readLoglineConfig(cwd);
  const baseBranch = options.baseBranch ?? 'main';
  const branchName = `logline/add-analytics-${Date.now()}`;

  console.log('\n🔍 Analyzing codebase for missing analytics...\n');

  // Prefer tracking plan if present, otherwise run scan
  const scanResult = await loadScanResult(cwd);

  const gaps = scanResult.gaps.filter((g) => !IGNORED_EVENTS.includes(g.suggestedEvent));

  if (gaps.length === 0) {
    console.log('✓ No missing analytics events found!');
    return;
  }

  console.log(`Found ${gaps.length} events to add:\n`);
  for (const gap of gaps) {
    console.log(`  • ${gap.suggestedEvent} → ${gap.location?.file ?? 'unknown'}`);
  }

  if (options.dryRun) {
    console.log('\n📝 Preview of changes:\n');

    for (const gap of gaps) {
      if (!gap.location || gap.location.file === 'unknown') continue;

      const filePath = path.join(cwd, gap.location.file);
      if (!fs.existsSync(filePath)) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const targetLine = getEffectiveTargetLine(content, gap);

      // Generate the tracking code (signal-type aware)
      const loggingConfig = config.logging ?? { importPath: '@/lib/logger', instanceName: 'logger', destination: 'console' as const };
      const trackingCode = generateTrackingCode(gap, content, targetLine, {
        functionName: config.tracking.functionName,
        signalType: gap.signalType,
        logging: { importPath: loggingConfig.importPath, instanceName: loggingConfig.instanceName },
      });

      // Show diff preview with signal type label
      const signalLabel = signalTypeLabel(gap.signalType);
      console.log('─'.repeat(60));
      console.log(`📄 ${gap.location.file}:${targetLine}${signalLabel}`);
      console.log('─'.repeat(60));

      // Show context (3 lines before)
      const startLine = Math.max(0, targetLine - 4);
      const endLine = Math.min(lines.length, targetLine + 2);

      for (let i = startLine; i < targetLine; i++) {
        console.log(`  ${String(i + 1).padStart(3)} │ ${lines[i]}`);
      }

      // Show insertion (in green)
      const indent = lines[targetLine - 1]?.match(/^(\s*)/)?.[1] || '  ';
      const indentedCode = trackingCode
        .trim()
        .split('\n')
        .map((l) => `\x1b[32m+     │ ${indent}${l}\x1b[0m`)
        .join('\n');
      console.log(indentedCode);

      // Show context (2 lines after)
      for (let i = targetLine; i < endLine; i++) {
        console.log(`  ${String(i + 1).padStart(3)} │ ${lines[i]}`);
      }

      // Show analytics import if needed
      const needsAnalytics = gap.signalType !== 'operation' && gap.signalType !== 'error';
      const hasAnalyticsImport =
        new RegExp(`\\b${config.tracking.functionName}\\b`).test(content) ||
        content.includes(`from '${config.tracking.importPath}'`) ||
        content.includes(`from "${config.tracking.importPath}"`);
      if (needsAnalytics && !hasAnalyticsImport) {
        console.log('\n  \x1b[33mImport to add:\x1b[0m');
        console.log(`  \x1b[32m+ import { ${config.tracking.functionName} } from '${config.tracking.importPath}';\x1b[0m`);
      }

      // Show logger import if needed for operation/error/state_change
      const needsLogger = gap.signalType === 'operation' || gap.signalType === 'error' || gap.signalType === 'state_change';
      if (needsLogger) {
        const lc = config.logging ?? { importPath: '@/lib/logger', instanceName: 'logger' };
        const hasLoggerImport =
          content.includes(`from '${lc.importPath}'`) ||
          content.includes(`from "${lc.importPath}"`);
        if (!hasLoggerImport) {
          console.log('\n  \x1b[33mLogger import to add:\x1b[0m');
          console.log(`  \x1b[32m+ import { ${lc.instanceName} } from '${lc.importPath}';\x1b[0m`);
        }
      }

      console.log();
    }

    // Check if analytics module needs to be created
    const analyticsPath = path.join(cwd, 'src', 'lib', 'analytics.ts');
    if (!fs.existsSync(analyticsPath)) {
      console.log('─'.repeat(60));
      console.log('📄 src/lib/analytics.ts (new file)');
      console.log('─'.repeat(60));
      console.log('\x1b[32m+ // Analytics module generated by Logline');
      console.log(`+ export function ${config.tracking.functionName}(eventName: string, properties: Record<string, unknown>): void {`);
      console.log("+   console.log('[Analytics]', eventName, properties);");
      console.log('+ }\x1b[0m');
      console.log();
    }

    console.log('─'.repeat(60));
    console.log(`\n${gaps.length} events would be added.`);
    console.log('Run `logline pr` without --dry-run to create the PR.\n');
    return;
  }

  // Create branch
  console.log(`\n📦 Creating branch: ${branchName}`);
  execSync(`git checkout -b ${branchName}`, { cwd, stdio: 'inherit' });

  // Group gaps by file so we apply all inserts per file correctly
  const fileToGaps = new Map<string, TrackingGap[]>();
  for (const gap of gaps) {
    if (!gap.location || gap.location.file === 'unknown') continue;
    const filePath = path.join(cwd, gap.location.file);
    if (!fs.existsSync(filePath)) continue;

    const list = fileToGaps.get(gap.location.file) ?? [];
    list.push(gap);
    fileToGaps.set(gap.location.file, list);
  }

  // Apply changes per file (gaps sorted by line descending so inserts don't shift)
  const changedFiles = new Set<string>();

  for (const [relativePath, gaps] of fileToGaps) {
    const filePath = path.join(cwd, relativePath);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Sort by line descending so later inserts don't affect earlier line numbers
    const sorted = [...gaps].sort((a, b) => (b.location?.line ?? 0) - (a.location?.line ?? 0));

    for (const gap of sorted) {
      const targetLine = getEffectiveTargetLine(content, gap);
      const lc = config.logging ?? { importPath: '@/lib/logger', instanceName: 'logger', destination: 'console' as const };
      const trackingCode = generateTrackingCode(gap, content, targetLine, {
        functionName: config.tracking.functionName,
        signalType: gap.signalType,
        logging: { importPath: lc.importPath, instanceName: lc.instanceName },
      });
      content = insertTracking(content, targetLine, trackingCode);

      // Analytics import (action / state_change)
      if (gap.signalType !== 'operation' && gap.signalType !== 'error') {
        content = ensureTrackImport(content, relativePath, config.tracking.importPath, config.tracking.functionName);
      }
      // Logger import (operation / error / state_change)
      if (gap.signalType === 'operation' || gap.signalType === 'error' || gap.signalType === 'state_change') {
        content = ensureTrackImport(content, relativePath, lc.importPath, lc.instanceName);
      }

      const label = signalTypeLabel(gap.signalType);
      console.log(`  ✓ ${gap.suggestedEvent}${label} added to ${relativePath}`);
    }

    fs.writeFileSync(filePath, content);
    changedFiles.add(relativePath);
  }

  // Ensure analytics module exists
  ensureAnalyticsModule(cwd, config.tracking.functionName);

  // Ensure logger module exists if any operational signals were added
  const hasOperationalSignals = gaps.some(
    (g) => g.signalType === 'operation' || g.signalType === 'error' || g.signalType === 'state_change'
  );
  if (hasOperationalSignals) {
    ensureLoggerModule(cwd, config);
  }

  // Commit changes
  console.log('\n📝 Committing changes...');
  execSync('git add .', { cwd });
  const commitMsg = `feat(analytics): Add ${gaps.length} tracking events

Events added:
${gaps.map((g) => `- ${g.suggestedEvent}`).join('\n')}

Generated by Logline`;
  const commitFile = path.join(cwd, '.logline', '.commit-msg.txt');
  fs.mkdirSync(path.dirname(commitFile), { recursive: true });
  fs.writeFileSync(commitFile, commitMsg);
  execSync(`git commit -F "${commitFile}"`, { cwd });
  fs.unlinkSync(commitFile);

  // Update tracking plan: mark instrumented events as 'implemented'
  const plan = readTrackingPlan(cwd);
  if (plan) {
    const instrumentedNames = new Set(gaps.map((g) => g.suggestedEvent));
    const now = new Date().toISOString();
    plan.events = plan.events.map((e) => {
      if (instrumentedNames.has(e.name) && (e.status === 'suggested' || e.status === 'approved')) {
        return { ...e, status: 'implemented' as const, lastSeen: now };
      }
      return e;
    });
    const active = plan.events.filter((e) => e.status !== 'deprecated');
    const implemented = active.filter((e) => e.status === 'implemented').length;
    const total = active.length;
    plan.coverage = {
      ...plan.coverage,
      implemented,
      suggested: active.filter((e) => e.status === 'suggested').length,
      approved: active.filter((e) => e.status === 'approved').length,
      percentage: total > 0 ? Math.round((implemented / total) * 100) : 0,
    };
    writeTrackingPlan(cwd, plan);
    execSync('git add .logline/tracking-plan.json', { cwd });
    execSync(`git commit --amend --no-edit`, { cwd });
  }

  // Push and create PR
  console.log('\n🚀 Pushing branch...');
  execSync(`git push -u origin ${branchName}`, { cwd, stdio: 'inherit' });

  // Create PR using GitHub CLI if available
  const prTitle = options.title ?? `feat(analytics): Add ${gaps.length} tracking events`;
  const prBody = generatePRBody({ ...scanResult, gaps });

  try {
    const bodyFile = path.join(cwd, '.logline', '.pr-body.md');
    fs.mkdirSync(path.dirname(bodyFile), { recursive: true });
    fs.writeFileSync(bodyFile, prBody);
    const result = spawnSync('gh', ['pr', 'create', '--title', prTitle, '--body-file', bodyFile, '--base', baseBranch], {
      cwd,
      stdio: 'inherit',
    });
    fs.unlinkSync(bodyFile);
    if (result.status !== 0) throw new Error('gh pr create failed');
    console.log('\n✓ PR created successfully!');
  } catch {
    console.log('\n⚠️  Could not create PR automatically. Push completed - create PR manually.');
    console.log(`   Branch: ${branchName}`);
  }
}

/** Load scan result: from .logline/tracking-plan.json if present, else run scan */
async function loadScanResult(cwd: string): Promise<ScanResult> {
  const plan = readTrackingPlan(cwd);
  if (plan?.events?.length) {
    // Only instrument suggested and approved events (approved first)
    const toInstrument = plan.events
      .filter((e) => e.status === 'suggested' || e.status === 'approved')
      .sort((a, b) => {
        if (a.status === 'approved' && b.status !== 'approved') return -1;
        if (b.status === 'approved' && a.status !== 'approved') return 1;
        return 0;
      });

    const gaps: TrackingGap[] = toInstrument.map((e) => ({
      suggestedEvent: e.name,
      reason: e.description,
      location: e.locations[0] ?? { file: 'unknown', line: 0 },
      confidence: 0.8,
      priority: e.priority,
      signalType: e.signalType,
      description: e.description,
      includes: e.includes,
    }));

    const events: DetectedEvent[] = plan.events
      .filter((e) => e.status === 'implemented')
      .map((e) => ({ name: e.name, locations: e.locations }));

    return {
      profile: plan.product,
      events,
      gaps,
      coverage: {
        tracked: plan.coverage.implemented,
        missing: plan.coverage.suggested + plan.coverage.approved,
        percentage: plan.coverage.percentage,
      },
    };
  }

  console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first for better results.'));
  return scanCommand({ cwd });
}

function findHandlerDefinition(content: string, handlerName: string): number | null {
  const escaped = handlerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`const\\s+${escaped}\\s*=`),
    new RegExp(`function\\s+${escaped}\\s*\\(`),
  ];

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      if (pattern.test(lines[i])) {
        return i + 1; // 1-indexed
      }
    }
  }
  return null;
}

function getEffectiveTargetLine(content: string, gap: TrackingGap): number {
  const targetLine = gap.location?.line ?? 0;
  if (targetLine <= 0) return targetLine;

  const lines = content.split('\n');
  const lineIndex = targetLine - 1;

  // Build context: the line and nearby lines (onClick can span multiple lines)
  const contextStart = Math.max(0, lineIndex - 2);
  const contextEnd = Math.min(lines.length, lineIndex + 3);
  const context = lines.slice(contextStart, contextEnd).join('\n');

  // Check for direct handler: onClick={handleAddMapping} or inline: onClick={() => handlerName(...)}
  const directHandlerMatch = context.match(/onClick=\{(\w+)\}/);
  const inlineMatch = context.match(/onClick\s*=\s*\{[^}]*?(\w+)\s*\(/);
  const hint = gap.location?.hint ?? '';
  const hintMatch = hint.match(/onClick=\{[^}]*?(\w+)\s*\(/);

  const handlerName = directHandlerMatch?.[1] ?? inlineMatch?.[1] ?? hintMatch?.[1];
  if (handlerName) {
    const handlerLine = findHandlerDefinition(content, handlerName);
    if (handlerLine) {
      return handlerLine;
    }
  }

  return targetLine;
}

function generatePRBody(scanResult: ScanResult & { gaps?: TrackingGap[] }): string {
  const gaps = scanResult.gaps ?? [];
  const rows = gaps
    .map((g) => `| \`${g.suggestedEvent}\` | ${g.location?.file ?? 'TBD'} | ${g.priority} |`)
    .join('\n');

  return `## 📊 Analytics Events Added

This PR adds ${gaps.length} analytics tracking events to improve product observability.

### Events Added

| Event | Location | Priority |
|-------|----------|----------|
${rows}

### Product Context

**Mission:** ${scanResult.profile.mission}

**Key Metrics:** ${scanResult.profile.keyMetrics?.join(', ') ?? 'Not specified'}

---

*Generated by [Logline](https://github.com/yourname/logline)*`;
}

function insertTracking(content: string, targetLine: number, trackingCode: string): string {
  const lines = content.split('\n');
  let insertLine = targetLine > 0 ? targetLine - 1 : Math.floor(lines.length / 2);

  // Find a better insertion point - look for function handlers, useEffect
  if (targetLine > 0 && targetLine < lines.length) {
    for (let i = Math.max(0, targetLine - 20); i < Math.min(lines.length, targetLine + 20); i++) {
      const line = lines[i];
      if (/const\s+handle\w+\s*=|onClick\s*=|useEffect\s*\(/.test(line)) {
        for (let j = i; j < Math.min(lines.length, i + 10); j++) {
          if (lines[j].includes('{')) {
            insertLine = j + 1;
            break;
          }
        }
        break;
      }
    }

    if (insertLine === targetLine - 1) {
      for (let i = Math.max(0, targetLine - 10); i < targetLine; i++) {
        if (lines[i]?.includes('useState') && lines[i]?.includes('}')) {
          for (let j = i; j < Math.min(lines.length, i + 5); j++) {
            if (lines[j]?.trim() === ');') {
              insertLine = j + 1;
              break;
            }
          }
          break;
        }
      }
    }
  }

  insertLine = Math.max(0, Math.min(insertLine, lines.length - 1));
  const indent = lines[insertLine]?.match(/^(\s*)/)?.[1] ?? '  ';
  const indentedTrackingCode = trackingCode
    .trim()
    .split('\n')
    .map((l) => indent + l)
    .join('\n');

  const newLines = [...lines];
  newLines.splice(insertLine, 0, indentedTrackingCode);
  return newLines.join('\n');
}

function ensureTrackImport(content: string, filePath: string, importPath: string, functionName: string): string {
  const hasImport =
    new RegExp(`import\\s+\\{[^}]*\\b${escapeRegExp(functionName)}\\b[^}]*\\}`).test(content) ||
    content.includes(`from '${importPath}'`) ||
    content.includes(`from "${importPath}"`);
  if (hasImport) return content;

  const lines = content.split('\n');
  let lastImportIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ')) lastImportIndex = i;
  }

  const importLine = `import { ${functionName} } from '${importPath}';`;

  if (lastImportIndex >= 0) {
    lines.splice(lastImportIndex + 1, 0, importLine);
    return lines.join('\n');
  }

  // No imports - add at top
  lines.unshift(importLine, '');
  return lines.join('\n');
}

function ensureAnalyticsModule(cwd: string, functionName: string): void {
  const analyticsPath = path.join(cwd, 'src', 'lib', 'analytics.ts');

  if (fs.existsSync(analyticsPath)) return;

  const dir = path.dirname(analyticsPath);
  fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    analyticsPath,
    `// Analytics module generated by Logline

export function ${functionName}(eventName: string, properties: Record<string, unknown>): void {
  // TODO: Replace with your analytics provider
  // Examples:
  // - Segment: analytics.track(eventName, properties)
  // - PostHog: posthog.capture(eventName, properties)
  // - Mixpanel: mixpanel.track(eventName, properties)

  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics]', eventName, properties);
  }
}
`
  );

  console.log('  ✓ Created src/lib/analytics.ts');
}

function signalTypeLabel(signalType?: string): string {
  switch (signalType) {
    case 'action': return ' (action → track())';
    case 'operation': return ' (operation → logger.info())';
    case 'error': return ' (error → logger.error())';
    case 'state_change': return ' (state_change → track() + logger.info())';
    default: return '';
  }
}

function ensureLoggerModule(cwd: string, config: LoglineConfig): void {
  const loggingConfig = config.logging;
  const instanceName = loggingConfig?.instanceName ?? 'logger';
  const loggerPath = path.join(cwd, 'src', 'lib', 'logger.ts');

  if (fs.existsSync(loggerPath)) return;

  const dir = path.dirname(loggerPath);
  fs.mkdirSync(dir, { recursive: true });

  let template: string;
  switch (loggingConfig?.destination) {
    case 'pino':
      template = `// Logger module generated by Logline
import pino from 'pino';

export const ${instanceName} = pino({ level: process.env.LOG_LEVEL ?? 'info' });
`;
      break;
    case 'winston':
      template = `// Logger module generated by Logline
import winston from 'winston';

export const ${instanceName} = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});
`;
      break;
    default:
      template = `// Logger module generated by Logline
// Replace with pino, winston, or your preferred structured logger.

export const ${instanceName} = {
  info(event: string, context: Record<string, unknown> = {}): void {
    console.log(JSON.stringify({ level: 'info', event, ...context, timestamp: new Date().toISOString() }));
  },
  warn(event: string, context: Record<string, unknown> = {}): void {
    console.warn(JSON.stringify({ level: 'warn', event, ...context, timestamp: new Date().toISOString() }));
  },
  error(event: string, context: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({ level: 'error', event, ...context, timestamp: new Date().toISOString() }));
  },
};
`;
  }

  fs.writeFileSync(loggerPath, template);
  console.log('  ✓ Created src/lib/logger.ts');
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
