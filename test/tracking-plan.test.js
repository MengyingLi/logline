const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  generateEventId,
  getTrackingPlanPath,
  readTrackingPlan,
  writeTrackingPlan,
  mergeTrackingPlan,
  createEmptyTrackingPlan,
} = require('../dist/lib/utils/tracking-plan.js');

// ─── Helpers ───

function makeEvent(name, status = 'suggested', overrides = {}) {
  return {
    id: generateEventId(name),
    name,
    description: `${name} event`,
    actor: 'User',
    object: 'Workflow',
    action: 'created',
    properties: [],
    locations: [{ file: 'src/app.ts', line: 10 }],
    priority: 'high',
    status,
    signalType: 'action',
    firstSeen: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const baseProduct = {
  mission: 'Test product',
  valueProposition: '',
  businessGoals: [],
  userPersonas: [],
  keyMetrics: [],
  confidence: 0.5,
};

const baseCoverage = { tracked: 0, suggested: 1, approved: 0, implemented: 0, percentage: 0 };

function makePlan(events) {
  return {
    version: '1.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    generatedBy: 'logline@test',
    product: baseProduct,
    events,
    coverage: baseCoverage,
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logline-tp-'));
}

// ─── generateEventId ───

test('generateEventId returns stable id for same name', () => {
  assert.equal(generateEventId('workflow_created'), generateEventId('workflow_created'));
});

test('generateEventId starts with evt_', () => {
  assert.ok(generateEventId('workflow_created').startsWith('evt_'));
});

test('generateEventId returns different ids for different names', () => {
  assert.notEqual(generateEventId('workflow_created'), generateEventId('workflow_deleted'));
});

// ─── readTrackingPlan / writeTrackingPlan ───

test('readTrackingPlan returns null when file does not exist', () => {
  const dir = tmpDir();
  assert.equal(readTrackingPlan(dir), null);
});

test('readTrackingPlan returns null for corrupt JSON', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.logline'));
  fs.writeFileSync(path.join(dir, '.logline', 'tracking-plan.json'), '{ not valid json }');
  assert.equal(readTrackingPlan(dir), null);
});

test('readTrackingPlan returns null when events array is missing', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, '.logline'));
  fs.writeFileSync(path.join(dir, '.logline', 'tracking-plan.json'), JSON.stringify({ version: '1.0' }));
  assert.equal(readTrackingPlan(dir), null);
});

test('writeTrackingPlan + readTrackingPlan round-trips correctly', () => {
  const dir = tmpDir();
  const plan = makePlan([makeEvent('workflow_created')]);
  writeTrackingPlan(dir, plan);
  const read = readTrackingPlan(dir);
  assert.ok(read !== null);
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].name, 'workflow_created');
});

test('writeTrackingPlan creates .logline directory if missing', () => {
  const dir = tmpDir();
  const plan = makePlan([]);
  writeTrackingPlan(dir, plan);
  assert.ok(fs.existsSync(path.join(dir, '.logline', 'tracking-plan.json')));
});

test('getTrackingPlanPath returns .logline/tracking-plan.json', () => {
  const p = getTrackingPlanPath('/project');
  assert.equal(p, path.join('/project', '.logline', 'tracking-plan.json'));
});

// ─── mergeTrackingPlan ───

test('mergeTrackingPlan with null existing creates a fresh plan', () => {
  const events = [makeEvent('workflow_created')];
  const plan = mergeTrackingPlan(null, events, baseProduct, baseCoverage);
  assert.equal(plan.version, '1.0');
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0].name, 'workflow_created');
});

test('mergeTrackingPlan: new event added to existing plan', () => {
  const existing = makePlan([makeEvent('workflow_created')]);
  const merged = mergeTrackingPlan(existing, [makeEvent('workflow_created'), makeEvent('workflow_deleted')], baseProduct, baseCoverage);
  assert.equal(merged.events.length, 2);
  assert.ok(merged.events.some((e) => e.name === 'workflow_deleted'));
});

test('mergeTrackingPlan: suggested event gets updated', () => {
  const existingEvent = makeEvent('workflow_created', 'suggested', { description: 'old description' });
  const existing = makePlan([existingEvent]);
  const newEvent = makeEvent('workflow_created', 'suggested', { description: 'new description' });
  const merged = mergeTrackingPlan(existing, [newEvent], baseProduct, baseCoverage);
  const updated = merged.events.find((e) => e.name === 'workflow_created');
  assert.equal(updated.description, 'new description');
  assert.equal(updated.status, 'suggested');
  assert.equal(updated.firstSeen, existingEvent.firstSeen, 'firstSeen should be preserved');
});

test('mergeTrackingPlan: approved event preserves all fields except locations and lastSeen', () => {
  const existingEvent = makeEvent('workflow_created', 'approved', {
    description: 'approved description',
    locations: [{ file: 'src/old.ts', line: 5 }],
  });
  const existing = makePlan([existingEvent]);
  const newEvent = makeEvent('workflow_created', 'suggested', {
    description: 'new scan description',
    locations: [{ file: 'src/new.ts', line: 99 }],
  });
  const merged = mergeTrackingPlan(existing, [newEvent], baseProduct, baseCoverage);
  const updated = merged.events.find((e) => e.name === 'workflow_created');
  assert.equal(updated.status, 'approved', 'status should stay approved');
  assert.equal(updated.description, 'approved description', 'description should be preserved');
  assert.equal(updated.locations[0].file, 'src/new.ts', 'locations should be updated');
});

test('mergeTrackingPlan: implemented event only updates lastSeen', () => {
  const existingEvent = makeEvent('workflow_created', 'implemented', { description: 'impl description' });
  const existing = makePlan([existingEvent]);
  const newEvent = makeEvent('workflow_created', 'suggested', { description: 'new description' });
  const merged = mergeTrackingPlan(existing, [newEvent], baseProduct, baseCoverage);
  const updated = merged.events.find((e) => e.name === 'workflow_created');
  assert.equal(updated.status, 'implemented');
  assert.equal(updated.description, 'impl description', 'description should not change for implemented');
});

test('mergeTrackingPlan: deprecated event is left untouched', () => {
  const existingEvent = makeEvent('workflow_created', 'deprecated', { description: 'deprecated' });
  const existing = makePlan([existingEvent]);
  const newEvent = makeEvent('workflow_created', 'suggested', { description: 'new description' });
  const merged = mergeTrackingPlan(existing, [newEvent], baseProduct, baseCoverage);
  const updated = merged.events.find((e) => e.name === 'workflow_created');
  assert.equal(updated.status, 'deprecated');
  assert.equal(updated.description, 'deprecated', 'deprecated event should not be modified');
});

test('mergeTrackingPlan: event removed from scan stays in plan without lastSeen update', () => {
  const existingEvent = makeEvent('workflow_created', 'approved', { lastSeen: '2024-01-01T00:00:00.000Z' });
  const existing = makePlan([existingEvent]);
  // new scan has no events at all
  const merged = mergeTrackingPlan(existing, [], baseProduct, baseCoverage);
  const kept = merged.events.find((e) => e.name === 'workflow_created');
  assert.ok(kept, 'event removed from scan should remain in plan');
  assert.equal(kept.lastSeen, '2024-01-01T00:00:00.000Z', 'lastSeen should not update');
});

test('mergeTrackingPlan: preserves context when provided', () => {
  const context = { actors: [{ name: 'User', type: 'user', source: 'inferred', identifierPattern: 'user.id', canPerformActions: [], detectedFrom: 'test', confidence: 0.7 }], objects: [], relationships: [], lifecycles: [] };
  const plan = mergeTrackingPlan(null, [], baseProduct, baseCoverage, context);
  assert.deepEqual(plan.context, context);
});

// ─── createEmptyTrackingPlan ───

test('createEmptyTrackingPlan returns plan with empty events array', () => {
  const plan = createEmptyTrackingPlan();
  assert.equal(plan.version, '1.0');
  assert.deepEqual(plan.events, []);
});

test('createEmptyTrackingPlan accepts optional product profile', () => {
  const plan = createEmptyTrackingPlan(baseProduct);
  assert.equal(plan.product.mission, 'Test product');
});
