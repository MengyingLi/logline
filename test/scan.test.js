const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { scanCommand } = require('../dist/commands/scan.js');
const { specCommand } = require('../dist/commands/spec.js');
const { readTrackingPlan, writeTrackingPlan } = require('../dist/lib/utils/tracking-plan.js');

const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures');

test('nextjs-saas: finds existing segment-like calls', async () => {
  const result = await scanCommand({ cwd: path.join(fixtureRoot, 'nextjs-saas'), fast: true });
  assert.ok(result.events.length > 0);
  assert.ok(result.events.some((e) => e.framework === 'segment'));
});

test('no garbage event names in any fixture', async () => {
  for (const fixture of ['nextjs-saas', 'express-api', 'react-spa']) {
    const result = await scanCommand({ cwd: path.join(fixtureRoot, fixture), fast: true });
    const garbage = result.gaps.filter((g) => /^(\w+)_\1ed$/.test(g.suggestedEvent));
    assert.equal(garbage.length, 0);
  }
});

test('express-api: detects route handlers and CRUD-ish events', async () => {
  const result = await scanCommand({ cwd: path.join(fixtureRoot, 'express-api'), fast: true });
  assert.ok(result.gaps.some((g) => /created|updated|deleted/.test(g.suggestedEvent)));
});

test('handles empty project gracefully', async () => {
  await assert.rejects(
    () => scanCommand({ cwd: path.join(fixtureRoot, 'empty'), fast: true, json: true }),
    /No source files found/i
  );
});

test('spec is idempotent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-spec-idempotent-'));
  copyDir(path.join(fixtureRoot, 'react-spa'), tmp);

  await specCommand({ cwd: tmp });
  const first = readTrackingPlan(tmp);
  assert.ok(first);
  const firstIds = new Set((first?.events ?? []).map((e) => e.id));

  await specCommand({ cwd: tmp });
  const second = readTrackingPlan(tmp);
  assert.ok(second);
  const secondIds = new Set((second?.events ?? []).map((e) => e.id));

  assert.deepEqual(secondIds, firstIds);
});

test('tracking plan merge preserves approved events', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-spec-merge-'));
  copyDir(path.join(fixtureRoot, 'express-api'), tmp);

  await specCommand({ cwd: tmp });
  const plan = readTrackingPlan(tmp);
  assert.ok(plan && plan.events.length > 0);

  plan.events[0] = { ...plan.events[0], status: 'approved' };
  writeTrackingPlan(tmp, plan);

  await specCommand({ cwd: tmp });
  const merged = readTrackingPlan(tmp);
  assert.ok(merged);

  const sameEvent = merged.events.find((e) => e.id === plan.events[0].id);
  assert.ok(sameEvent);
  assert.equal(sameEvent.status, 'approved');
});

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

