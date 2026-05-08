import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { glob } from 'glob';
import { readTrackingPlan } from '../lib/utils/tracking-plan';
import { readLoglineConfig } from '../lib/utils/config';
import type { TrackingPlanEvent } from '../lib/types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrackCall {
  file: string;
  line: number;
  eventName: string;
  propsRaw: string; // raw text of the properties argument, may be empty
  propKeys: string[]; // extracted property keys from the object literal
}

interface LintViolation {
  file: string;
  line: number;
  eventName: string;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  suggestion?: string;
}

// ─── Track call extraction ─────────────────────────────────────────────────────

/**
 * Extract all track() calls from a file's content.
 * Handles single-line and simple multi-line object literals.
 */
function extractTrackCalls(content: string, relPath: string, fnName: string): TrackCall[] {
  const calls: TrackCall[] = [];
  const lines = content.split('\n');

  // Regex: fnName( 'eventName' or "eventName"
  const callRe = new RegExp(`\\b${escapeRegex(fnName)}\\s*\\(\\s*(['"\`])([^'"\\n\`]+)\\1`, 'g');

  let match: RegExpExecArray | null;
  while ((match = callRe.exec(content)) !== null) {
    const line = lineNumber(content, match.index);
    const eventName = match[2];

    // Find the rest of the call to extract property keys
    const afterName = content.slice(match.index + match[0].length);
    const propKeys = extractPropertyKeys(afterName);

    calls.push({ file: relPath, line, eventName, propsRaw: '', propKeys });
  }

  return calls;
}

/** Convert a character offset to a 1-based line number. */
function lineNumber(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

/**
 * Extract property keys from the text immediately after the event-name argument.
 * Looks for ", { key: ... }" or ", { ...spread }". Very tolerant of formatting.
 */
function extractPropertyKeys(afterName: string): string[] {
  // Skip whitespace + comma
  const commaIdx = afterName.indexOf(',');
  if (commaIdx === -1) return [];

  const afterComma = afterName.slice(commaIdx + 1).trimStart();
  if (!afterComma.startsWith('{')) return [];

  // Scan for matching closing brace
  let depth = 0;
  let objEnd = -1;
  for (let i = 0; i < afterComma.length; i++) {
    if (afterComma[i] === '{') depth++;
    else if (afterComma[i] === '}') {
      depth--;
      if (depth === 0) { objEnd = i; break; }
    }
  }

  const objText = objEnd !== -1 ? afterComma.slice(0, objEnd + 1) : afterComma.slice(0, 200);

  // Match `key:` patterns (JS object keys — identifiers or quoted)
  const keyRe = /(?:^|,|\{)\s*(?:\.\.\.)?(\w+)\s*:/g;
  const keys: string[] = [];
  let km: RegExpExecArray | null;
  while ((km = keyRe.exec(objText)) !== null) {
    if (km[1]) keys.push(km[1]);
  }
  return keys;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Validation ───────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]!
        : 1 + Math.min(d[i - 1][j]!, d[i][j - 1]!, d[i - 1][j - 1]!);
    }
  }
  return d[m][n]!;
}

function findClosestEvent(name: string, events: TrackingPlanEvent[]): string | undefined {
  const lower = name.toLowerCase();
  // Only suggest if distance ≤ 4 characters
  let best: string | undefined;
  let bestDist = 5;
  for (const e of events) {
    const d = levenshtein(lower, e.name.toLowerCase());
    if (d < bestDist) { bestDist = d; best = e.name; }
  }
  return best;
}

function validateCall(call: TrackCall, byName: Map<string, TrackingPlanEvent>): LintViolation[] {
  const violations: LintViolation[] = [];
  const event = byName.get(call.eventName);

  if (!event) {
    const suggestion = findClosestEvent(call.eventName, [...byName.values()]);
    violations.push({
      file: call.file, line: call.line, eventName: call.eventName,
      severity: 'error',
      code: 'unknown-event',
      message: `'${call.eventName}' is not in the tracking plan`,
      suggestion: suggestion ? `did you mean '${suggestion}'?` : undefined,
    });
    return violations; // can't check props for unknown event
  }

  if (event.status === 'deprecated') {
    violations.push({
      file: call.file, line: call.line, eventName: call.eventName,
      severity: 'warning',
      code: 'deprecated-event',
      message: `'${call.eventName}' is deprecated in the tracking plan`,
    });
  }

  // Check required properties
  const required = event.properties.filter((p) => p.required && !p.todo);
  for (const prop of required) {
    if (!call.propKeys.includes(prop.name)) {
      violations.push({
        file: call.file, line: call.line, eventName: call.eventName,
        severity: 'error',
        code: 'missing-required-prop',
        message: `missing required property '${prop.name}'`,
      });
    }
  }

  return violations;
}

// ─── Core (exported for programmatic use and testing) ────────────────────────

export interface LintResult {
  calls: number;
  violations: LintViolation[];
}

export async function lintFiles(cwd: string): Promise<LintResult> {
  const plan = readTrackingPlan(cwd);
  if (!plan) return { calls: 0, violations: [] };

  const config = readLoglineConfig(cwd);
  const fnName = config.tracking.functionName;
  const ignore = [
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/.logline/**',
    ...config.scan.exclude,
  ];

  const activeEvents = plan.events.filter((e) => e.status !== 'deprecated');
  const byName = new Map<string, TrackingPlanEvent>(activeEvents.map((e) => [e.name, e]));
  for (const e of plan.events.filter((e) => e.status === 'deprecated')) {
    if (!byName.has(e.name)) byName.set(e.name, e);
  }

  const files: string[] = [];
  for (const pattern of config.scan.include) {
    const matches = await glob(pattern, { cwd, ignore, absolute: false });
    for (const m of matches) {
      if (!files.includes(m)) files.push(m);
    }
  }

  const allCalls: TrackCall[] = [];
  const violations: LintViolation[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(cwd, file), 'utf-8');
    const calls = extractTrackCalls(content, file, fnName);
    for (const call of calls) {
      allCalls.push(call);
      violations.push(...validateCall(call, byName));
    }
  }

  return { calls: allCalls.length, violations };
}

// ─── Main command ─────────────────────────────────────────────────────────────

export async function lintCommand(options: {
  cwd?: string;
  json?: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const plan = readTrackingPlan(cwd);
  if (!plan) {
    if (options.json) {
      process.stdout.write(JSON.stringify({ error: 'no-tracking-plan' }) + '\n');
    } else {
      console.log(chalk.dim('No tracking plan found. Run `logline init && logline spec` first.'));
    }
    return;
  }

  const config = readLoglineConfig(cwd);
  const fnName = config.tracking.functionName;

  const result = await lintFiles(cwd);
  const { calls: totalCalls, violations } = result;

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  process.stdout.write(chalk.dim(`Linting ${fnName}() calls across the codebase...\n\n`));

  if (totalCalls === 0) {
    console.log(chalk.dim(`No ${fnName}() calls found in scanned files.`));
    console.log(chalk.dim('Check your scan.include patterns in .logline/config.json.'));
    return;
  }

  // ── Group violations by file ──────────────────────────────────────────────
  const byFile = new Map<string, LintViolation[]>();
  for (const v of violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }

  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.filter((v) => v.severity === 'warning').length;
  const cleanCount = totalCalls - new Set(violations.map((v) => `${v.file}:${v.line}:${v.eventName}`)).size;

  if (violations.length > 0) {
    for (const [file, viols] of byFile) {
      console.log(chalk.bold(file));
      for (const v of viols.sort((a, b) => a.line - b.line)) {
        const icon = v.severity === 'error' ? chalk.red('✗') : chalk.yellow('⚠');
        const loc = chalk.dim(`${String(v.line).padStart(4)}  `);
        const ev = chalk.bold(v.eventName.padEnd(35));
        const msg = v.severity === 'error' ? chalk.red(v.message) : chalk.yellow(v.message);
        const hint = v.suggestion ? chalk.dim(`  (${v.suggestion})`) : '';
        console.log(`  ${icon} ${loc}${ev}${msg}${hint}`);
      }
      console.log();
    }
  }

  const callWord = `${totalCalls} call${totalCalls !== 1 ? 's' : ''}`;

  if (errors === 0 && warnings === 0) {
    console.log(chalk.green(`✓ All ${callWord} valid`) + chalk.dim(` — ${cleanCount} clean`));
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(chalk.red(`${errors} error${errors !== 1 ? 's' : ''}`));
    if (warnings > 0) parts.push(chalk.yellow(`${warnings} warning${warnings !== 1 ? 's' : ''}`));
    parts.push(chalk.dim(`${cleanCount} clean`));
    console.log(`${callWord} — ${parts.join(', ')}`);
    if (errors > 0) process.exitCode = 1;
  }
}
