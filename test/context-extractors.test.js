const test = require('node:test');
const assert = require('node:assert/strict');
const { extractTrackingPlanContext } = require('../dist/lib/context/actor-object-extractor.js');
const { detectLifecycles } = require('../dist/lib/context/lifecycle-detector.js');
const { generateMetrics } = require('../dist/lib/context/metric-generator.js');
const { generateExpectedSequences } = require('../dist/lib/context/expected-sequence.js');

// ─── extractTrackingPlanContext (actor-object-extractor) ───

test('detects User actor from req.user pattern', () => {
  const files = [{ path: 'src/api.ts', content: 'const userId = req.user.id;' }];
  const ctx = extractTrackingPlanContext(files);
  const user = ctx.actors.find((a) => a.name === 'User');
  assert.ok(user, 'should detect User actor');
  assert.equal(user.type, 'user');
});

test('detects User actor from useAuth hook', () => {
  const files = [{ path: 'src/app.tsx', content: 'const { user } = useAuth();' }];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.actors.some((a) => a.name === 'User'));
});

test('detects System actor from cron pattern', () => {
  const files = [{ path: 'src/jobs.ts', content: 'cron.schedule("* * * * *", () => {})' }];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.actors.some((a) => a.name === 'System' && a.type === 'system'));
});

test('detects Stripe actor from stripe + webhook pattern', () => {
  const files = [{ path: 'src/webhooks.ts', content: 'const stripe = new Stripe(key);\napp.post("/webhook", handleStripeWebhook)' }];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.actors.some((a) => a.name === 'Stripe' && a.type === 'integration'));
});

test('no actors for empty files', () => {
  const ctx = extractTrackingPlanContext([{ path: 'src/utils.ts', content: 'export function add(a, b) { return a + b; }' }]);
  assert.equal(ctx.actors.length, 0);
});

test('extracts Prisma objects', () => {
  const files = [{ path: 'src/db.ts', content: 'await prisma.workflow.create({ data });\nawait prisma.step.update({ where })' }];
  const ctx = extractTrackingPlanContext(files);
  const names = ctx.objects.map((o) => o.name);
  assert.ok(names.includes('Workflow'), `got: ${names}`);
  assert.ok(names.includes('Step'), `got: ${names}`);
});

test('extracts Supabase objects (singularises table name)', () => {
  const files = [{ path: 'src/db.ts', content: "const { data } = await supabase.from('workflows').select('*')" }];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.objects.some((o) => o.name === 'Workflow'));
});

test('extracts API route objects', () => {
  const files = [{ path: 'src/api.ts', content: "router.get('/api/users/:id', handler)" }];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.objects.some((o) => o.name === 'User' || o.name === 'Users'));
});

test('deduplicates objects across files', () => {
  const files = [
    { path: 'src/a.ts', content: 'await prisma.workflow.create({ data })' },
    { path: 'src/b.ts', content: 'await prisma.workflow.update({ where })' },
  ];
  const ctx = extractTrackingPlanContext(files);
  const workflows = ctx.objects.filter((o) => o.name.toLowerCase() === 'workflow');
  assert.equal(workflows.length, 1, 'should deduplicate Workflow');
});

test('builds relationships from foreign-key fields', () => {
  const files = [
    { path: 'src/db.ts', content: 'await prisma.workflow.create({ data });\nawait prisma.step.create({ data })' },
    { path: 'src/step.ts', content: 'const step = { workflowId: workflow.id, name };\nawait prisma.step.create({ data: step })' },
  ];
  const ctx = extractTrackingPlanContext(files);
  assert.ok(ctx.relationships.length > 0, 'should detect at least one relationship');
  const rel = ctx.relationships.find((r) => r.parent === 'Workflow');
  assert.ok(rel, `expected Workflow as parent, got: ${JSON.stringify(ctx.relationships)}`);
});

test('returns empty context for files with no signals', () => {
  const ctx = extractTrackingPlanContext([{ path: 'src/types.ts', content: 'export type Foo = string;' }]);
  assert.equal(ctx.actors.length, 0);
  assert.equal(ctx.objects.length, 0);
  assert.equal(ctx.relationships.length, 0);
});

// ─── detectLifecycles ───

test('detects enum Status lifecycle', () => {
  const files = [{ path: 'src/types.ts', content: 'enum WorkflowStatus { DRAFT, ACTIVE, COMPLETED }' }];
  const lifecycles = detectLifecycles(files);
  assert.equal(lifecycles.length, 1);
  assert.equal(lifecycles[0].object, 'Workflow');
  const states = lifecycles[0].states;
  assert.ok(states.includes('draft'), `got: ${states}`);
  assert.ok(states.includes('active'), `got: ${states}`);
  assert.ok(states.includes('completed'), `got: ${states}`);
});

test('detects enum State lifecycle', () => {
  const files = [{ path: 'src/types.ts', content: 'enum OrderState { PENDING, SHIPPED, DELIVERED }' }];
  const lifecycles = detectLifecycles(files);
  assert.equal(lifecycles.length, 1);
  assert.equal(lifecycles[0].object, 'Order');
});

test('ignores enums not ending in Status or State', () => {
  const files = [{ path: 'src/types.ts', content: 'enum Color { RED, GREEN, BLUE }' }];
  const lifecycles = detectLifecycles(files);
  assert.equal(lifecycles.length, 0);
});

test('detects type alias Status lifecycle', () => {
  const files = [
    { path: 'src/types.ts', content: "type WorkflowStatus = 'draft' | 'active' | 'archived';" },
  ];
  const lifecycles = detectLifecycles(files);
  assert.equal(lifecycles.length, 1);
  assert.equal(lifecycles[0].object, 'Workflow');
  assert.ok(lifecycles[0].states.includes('draft'));
  assert.ok(lifecycles[0].states.includes('active'));
  assert.ok(lifecycles[0].states.includes('archived'));
});

test('merges duplicate lifecycle objects across files', () => {
  const files = [
    { path: 'src/a.ts', content: 'enum WorkflowStatus { DRAFT, ACTIVE }' },
    { path: 'src/b.ts', content: "type WorkflowStatus = 'archived' | 'completed';" },
  ];
  const lifecycles = detectLifecycles(files);
  const workflow = lifecycles.find((l) => l.object === 'Workflow');
  assert.ok(workflow, 'should have Workflow lifecycle');
  assert.ok(workflow.states.includes('draft'));
  assert.ok(workflow.states.includes('archived'));
});

test('returns empty for files with no status enums', () => {
  const lifecycles = detectLifecycles([{ path: 'src/app.ts', content: 'const x = 1;' }]);
  assert.equal(lifecycles.length, 0);
});

// ─── generateMetrics ───

function makeEvent(name, priority = 'high', status = 'suggested') {
  return {
    id: `evt_${name}`,
    name,
    description: `${name} event`,
    actor: 'User',
    object: 'Object',
    action: 'action',
    properties: [],
    locations: [],
    priority,
    status,
    signalType: 'action',
    firstSeen: '2024-01-01',
    lastSeen: '2024-01-01',
  };
}

function makePlan(events, lifecycles = []) {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    generatedBy: 'test',
    product: { mission: 'test', valueProposition: '', businessGoals: [], userPersonas: [], keyMetrics: [], confidence: 0 },
    events,
    context: { actors: [], objects: [], relationships: [], lifecycles },
    coverage: { tracked: 0, suggested: 0, approved: 0, implemented: 0, percentage: 0 },
  };
}

test('generates count metric for every non-deprecated event', () => {
  const plan = makePlan([
    makeEvent('workflow_created'),
    makeEvent('workflow_deleted', 'low', 'deprecated'),
  ]);
  const metrics = generateMetrics(plan);
  const names = metrics.map((m) => m.name);
  assert.ok(names.includes('workflow_created_count'), `got: ${names}`);
  assert.ok(!names.includes('workflow_deleted_count'), `deprecated should be excluded, got: ${names}`);
});

test('count metric has stable id', () => {
  const plan = makePlan([makeEvent('workflow_created')]);
  const m1 = generateMetrics(plan)[0];
  const m2 = generateMetrics(plan)[0];
  assert.equal(m1.id, m2.id, 'id should be stable across calls');
});

test('count metric category: critical → activation', () => {
  const plan = makePlan([makeEvent('workflow_created', 'critical')]);
  const m = generateMetrics(plan).find((m) => m.name === 'workflow_created_count');
  assert.equal(m.category, 'activation');
});

test('count metric category: high → engagement', () => {
  const plan = makePlan([makeEvent('workflow_created', 'high')]);
  const m = generateMetrics(plan).find((m) => m.name === 'workflow_created_count');
  assert.equal(m.category, 'engagement');
});

test('generates conversion metric when both _created and _completed events exist', () => {
  const plan = makePlan(
    [makeEvent('workflow_created'), makeEvent('workflow_completed')],
    [{ object: 'Workflow', states: ['draft', 'completed'], transitions: [] }]
  );
  const metrics = generateMetrics(plan);
  const conversion = metrics.find((m) => m.name === 'workflow_completion_rate');
  assert.ok(conversion, `should have conversion metric, got: ${metrics.map((m) => m.name)}`);
  assert.ok(conversion.formula.includes('workflow_completed'));
  assert.ok(conversion.formula.includes('workflow_created'));
});

test('no conversion metric when only _created exists', () => {
  const plan = makePlan(
    [makeEvent('workflow_created')],
    [{ object: 'Workflow', states: ['draft'], transitions: [] }]
  );
  const metrics = generateMetrics(plan);
  assert.ok(!metrics.some((m) => m.name === 'workflow_completion_rate'));
});

test('deduplicates metrics by name', () => {
  const plan = makePlan([makeEvent('workflow_created'), makeEvent('workflow_created')]);
  const metrics = generateMetrics(plan);
  const countMetrics = metrics.filter((m) => m.name === 'workflow_created_count');
  assert.equal(countMetrics.length, 1);
});

// ─── generateExpectedSequences ───

function makeEvents(names) {
  return names.map((name) => makeEvent(name));
}

test('generates activation sequence when _created and _completed exist', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_completed']),
    lifecycles: [{ object: 'Workflow', states: ['draft', 'completed'], transitions: [] }],
  });
  assert.equal(sequences.length, 1);
  assert.equal(sequences[0].name, 'workflow_activation');
  assert.ok(sequences[0].steps.includes('workflow_created'));
  assert.ok(sequences[0].steps.includes('workflow_completed'));
});

test('includes _edited step in sequence when present', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_edited', 'workflow_completed']),
    lifecycles: [{ object: 'Workflow', states: [], transitions: [] }],
  });
  const steps = sequences[0].steps;
  assert.deepEqual(steps, ['workflow_created', 'workflow_edited', 'workflow_completed']);
});

test('includes _activated step when no _edited but _activated exists', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_activated', 'workflow_completed']),
    lifecycles: [{ object: 'Workflow', states: [], transitions: [] }],
  });
  const steps = sequences[0].steps;
  assert.deepEqual(steps, ['workflow_created', 'workflow_activated', 'workflow_completed']);
});

test('no sequence when _completed is missing', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_edited']),
    lifecycles: [{ object: 'Workflow', states: [], transitions: [] }],
  });
  assert.equal(sequences.length, 0);
});

test('no sequence when _created is missing', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_completed']),
    lifecycles: [{ object: 'Workflow', states: [], transitions: [] }],
  });
  assert.equal(sequences.length, 0);
});

test('generates sequences for multiple lifecycles', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_completed', 'order_created', 'order_completed']),
    lifecycles: [
      { object: 'Workflow', states: [], transitions: [] },
      { object: 'Order', states: [], transitions: [] },
    ],
  });
  assert.equal(sequences.length, 2);
  const names = sequences.map((s) => s.name);
  assert.ok(names.includes('workflow_activation'));
  assert.ok(names.includes('order_activation'));
});

test('sequence expectedWindow is 7d', () => {
  const sequences = generateExpectedSequences({
    events: makeEvents(['workflow_created', 'workflow_completed']),
    lifecycles: [{ object: 'Workflow', states: [], transitions: [] }],
  });
  assert.equal(sequences[0].expectedWindow, '7d');
});
