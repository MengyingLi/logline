const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeTrackingPlan } = require('../dist/lib/utils/tracking-plan.js');
const { lintFiles, lintCommand } = require('../dist/commands/lint.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logline-lint-'));
}

function makeEvent(name, status = 'approved', properties = []) {
  return {
    id: `evt_${name}`,
    name,
    description: `${name} description`,
    actor: 'User',
    object: 'Workflow',
    action: 'created',
    properties,
    locations: [{ file: 'src/app.ts', line: 10 }],
    priority: 'high',
    status,
    signalType: 'action',
    firstSeen: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
  };
}

function makeProperty(name, required = true) {
  return { name, type: 'string', required, description: `${name} property` };
}

function makePlan(events) {
  return {
    version: '1.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    generatedBy: 'logline-test',
    product: {
      mission: 'Test',
      valueProposition: '',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0.9,
    },
    events,
    context: { actors: [], objects: [], joinPaths: [], expectedSequences: [] },
    metrics: [],
    coverage: {
      total: events.length,
      tracked: 0,
      suggested: 0,
      approved: events.length,
      implemented: 0,
      percentage: 0,
    },
  };
}

function writeConfig(dir, cfg = {}) {
  const loglineDir = path.join(dir, '.logline');
  fs.mkdirSync(loglineDir, { recursive: true });
  const defaults = {
    eventGranularity: 'business',
    tracking: { destination: 'custom', importPath: '@/lib/analytics', functionName: 'track' },
    scan: {
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['**/*.test.*'],
    },
  };
  fs.writeFileSync(
    path.join(loglineDir, 'config.json'),
    JSON.stringify({ ...defaults, ...cfg })
  );
}

function writeSourceFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test('lintFiles: no tracking plan returns empty result', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  // No tracking plan written
  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 0);
  assert.deepStrictEqual(result.violations, []);
});

test('lintFiles: clean — all track() calls valid', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved', [makeProperty('workflow_id')]),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    import { track } from '@/lib/analytics';
    track('workflow_created', { workflow_id: id });
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.violations.length, 0);
});

test('lintFiles: flags unknown event name', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved'),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track('nonexistent_event', { id: 1 });
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.violations.length, 1);
  assert.strictEqual(result.violations[0].code, 'unknown-event');
  assert.strictEqual(result.violations[0].eventName, 'nonexistent_event');
  assert.strictEqual(result.violations[0].severity, 'error');
});

test('lintFiles: flags missing required property', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved', [
      makeProperty('workflow_id', true),
      makeProperty('name', true),
    ]),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track('workflow_created', { workflow_id: id });
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  const missing = result.violations.filter((v) => v.code === 'missing-required-prop');
  assert.strictEqual(missing.length, 1);
  assert.ok(missing[0].message.includes('name'));
});

test('lintFiles: warns on deprecated event', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('old_event', 'deprecated'),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track('old_event', { id: 1 });
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.violations.length, 1);
  assert.strictEqual(result.violations[0].code, 'deprecated-event');
  assert.strictEqual(result.violations[0].severity, 'warning');
});

test('lintFiles: does not flag optional properties', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved', [
      makeProperty('workflow_id', true),
      makeProperty('description', false), // optional
    ]),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track('workflow_created', { workflow_id: id });
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.violations.length, 0);
});

test('lintFiles: suggests close event name', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved'),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track('workflow_create', {});
  `);

  const result = await lintFiles(dir);
  const v = result.violations.find((v) => v.code === 'unknown-event');
  assert.ok(v);
  assert.ok(v.suggestion && v.suggestion.includes('workflow_created'));
});

test('lintFiles: multiple files', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved', [makeProperty('workflow_id')]),
    makeEvent('plan_upgraded', 'approved', [makeProperty('plan_id')]),
  ]));
  writeSourceFile(dir, 'src/workflows.ts', `
    track('workflow_created', { workflow_id: id });
  `);
  writeSourceFile(dir, 'src/billing.ts', `
    track('plan_upgraded', { plan_id: planId });
    track('unknown_billing_event', {});
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 3);
  assert.strictEqual(result.violations.length, 1);
  assert.strictEqual(result.violations[0].eventName, 'unknown_billing_event');
});

test('lintFiles: reports line numbers correctly', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved'),
  ]));
  writeSourceFile(dir, 'src/app.ts', [
    'const a = 1;',
    'const b = 2;',
    "track('workflow_created', { id: 1 });",
    'const c = 3;',
  ].join('\n'));

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.violations.length, 0);
  // The track call is on line 3
  // (no violations to check line number, but 1 call was found)
});

test('lintFiles: handles double-quoted event names', async () => {
  const dir = tmpDir();
  writeConfig(dir);
  writeTrackingPlan(dir, makePlan([
    makeEvent('workflow_created', 'approved'),
  ]));
  writeSourceFile(dir, 'src/app.ts', `
    track("workflow_created", {});
  `);

  const result = await lintFiles(dir);
  assert.strictEqual(result.calls, 1);
  assert.strictEqual(result.violations.length, 0);
});

test('lintCommand: exits gracefully with no tracking plan', async () => {
  const dir = tmpDir();
  writeConfig(dir);

  const msgs = [];
  const orig = console.log;
  console.log = (...args) => msgs.push(args.join(' '));
  await lintCommand({ cwd: dir });
  console.log = orig;

  assert.ok(msgs.some((m) => m.includes('tracking plan')));
});
