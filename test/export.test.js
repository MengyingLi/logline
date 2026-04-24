const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { writeTrackingPlan } = require('../dist/lib/utils/tracking-plan.js');
const { exportCommand } = require('../dist/commands/export.js');

// ─── Helpers ───

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logline-export-'));
}

function makeEvent(name, priority = 'high', status = 'suggested', properties = []) {
  return {
    id: `evt_${name}`,
    name,
    description: `${name} description`,
    actor: 'User',
    object: 'Workflow',
    action: 'created',
    properties,
    locations: [{ file: 'src/app.ts', line: 10 }],
    priority,
    status,
    signalType: 'action',
    firstSeen: '2024-01-01T00:00:00.000Z',
    lastSeen: '2024-01-01T00:00:00.000Z',
  };
}

function makeProperty(name, type = 'string', required = true) {
  return { name, type, required, description: `${name} property` };
}

function makePlanWithEvents(events) {
  return {
    version: '1.0',
    generatedAt: '2024-01-01T00:00:00.000Z',
    generatedBy: 'logline@test',
    product: {
      mission: 'Help teams ship faster',
      valueProposition: '',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0.8,
    },
    events,
    coverage: { tracked: 0, suggested: events.length, approved: 0, implemented: 0, percentage: 0 },
  };
}

// ─── Segment format ───

test('segment export produces valid JSON with rules array', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created', 'high', 'suggested', [makeProperty('workflow_id')])]);
  writeTrackingPlan(dir, plan);

  await exportCommand({ cwd: dir, format: 'segment' });

  const outPath = path.join(dir, 'segment-tracking-plan.json');
  assert.ok(fs.existsSync(outPath), 'segment-tracking-plan.json should be created');

  const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  assert.ok(Array.isArray(content.rules), 'should have rules array');
  assert.equal(content.rules.length, 1);
  assert.equal(content.rules[0].name, 'workflow_created');
});

test('segment export includes property schema', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [
      makeProperty('workflow_id', 'string', true),
      makeProperty('user_id', 'string', false),
    ]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'segment' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'segment-tracking-plan.json'), 'utf-8'));
  const rule = content.rules[0];
  // shape: rule.rules.properties.properties.properties.<propName>
  const props = rule.rules.properties.properties.properties;
  assert.ok(props.workflow_id, 'should include workflow_id property');
  assert.ok(props.user_id, 'should include user_id property');
});

test('segment export excludes deprecated events', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested'),
    makeEvent('workflow_deleted', 'low', 'deprecated'),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'segment' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'segment-tracking-plan.json'), 'utf-8'));
  assert.equal(content.rules.length, 1);
  assert.equal(content.rules[0].name, 'workflow_created');
});

test('segment required properties listed in JSON schema', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [
      makeProperty('workflow_id', 'string', true),
      makeProperty('notes', 'string', false),
    ]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'segment' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'segment-tracking-plan.json'), 'utf-8'));
  // shape: rule.rules.properties.properties.required
  const required = content.rules[0].rules.properties.properties.required;
  assert.ok(required.includes('workflow_id'), 'workflow_id should be required');
  assert.ok(!required.includes('notes'), 'notes should not be required');
});

// ─── Amplitude format ───

test('amplitude export produces valid JSON with events array', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created')]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'amplitude' });

  const outPath = path.join(dir, 'amplitude-taxonomy.json');
  assert.ok(fs.existsSync(outPath), 'amplitude-taxonomy.json should be created');

  const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  assert.ok(Array.isArray(content.events));
  assert.equal(content.events[0].name, 'workflow_created');
});

test('amplitude export: critical/high events are categorized as core', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('signup_completed', 'critical'),
    makeEvent('settings_viewed', 'low'),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'amplitude' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'amplitude-taxonomy.json'), 'utf-8'));
  const coreEvent = content.events.find((e) => e.name === 'signup_completed');
  const otherEvent = content.events.find((e) => e.name === 'settings_viewed');
  assert.equal(coreEvent.category, 'core');
  assert.equal(otherEvent.category, 'other');
});

test('amplitude export includes property details', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [makeProperty('workflow_id', 'string', true)]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'amplitude' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'amplitude-taxonomy.json'), 'utf-8'));
  const props = content.events[0].properties;
  assert.ok(props.length > 0, 'should have properties');
  assert.equal(props[0].name, 'workflow_id');
  assert.equal(props[0].is_required, true);
});

test('amplitude export maps date type to string', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [makeProperty('created_at', 'date', false)]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'amplitude' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'amplitude-taxonomy.json'), 'utf-8'));
  const prop = content.events[0].properties.find((p) => p.name === 'created_at');
  assert.equal(prop.type, 'string', 'date should be mapped to string');
});

// ─── OpenTelemetry format ───

test('otel export produces YAML file', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created')]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'opentelemetry' });

  const outPath = path.join(dir, 'otel-conventions.yaml');
  assert.ok(fs.existsSync(outPath), 'otel-conventions.yaml should be created');

  const content = fs.readFileSync(outPath, 'utf-8');
  assert.ok(content.includes('groups:'), 'should have groups key');
  assert.ok(content.includes('workflow_created'), 'should include event name');
});

test('otel export includes attributes for properties', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [makeProperty('workflow_id', 'string', true)]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'opentelemetry' });

  const content = fs.readFileSync(path.join(dir, 'otel-conventions.yaml'), 'utf-8');
  assert.ok(content.includes('attributes:'));
  assert.ok(content.includes('workflow_id'));
  assert.ok(content.includes('requirement_level: required'));
});

// ─── GlassFlow format ───

test('glassflow export produces valid JSON', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created')]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'glassflow' });

  const outPath = path.join(dir, 'glassflow-config.json');
  assert.ok(fs.existsSync(outPath), 'glassflow-config.json should be created');

  const content = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
  assert.equal(content.version, '1.0');
  assert.ok(Array.isArray(content.filters), 'should have filters');
  assert.ok(Array.isArray(content.schema.events), 'should have schema.events');
});

test('glassflow export has a filter for each event', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created'), makeEvent('workflow_deleted')]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'glassflow' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'glassflow-config.json'), 'utf-8'));
  assert.equal(content.filters.length, 2);
  assert.ok(content.filters.some((f) => f.match.event === 'workflow_created'));
  assert.ok(content.filters.some((f) => f.match.event === 'workflow_deleted'));
});

test('glassflow export creates transforms only for events with required properties', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([
    makeEvent('workflow_created', 'high', 'suggested', [makeProperty('workflow_id', 'string', true)]),
    makeEvent('page_viewed', 'low', 'suggested', [makeProperty('url', 'string', false)]),
  ]);
  writeTrackingPlan(dir, plan);
  await exportCommand({ cwd: dir, format: 'glassflow' });

  const content = JSON.parse(fs.readFileSync(path.join(dir, 'glassflow-config.json'), 'utf-8'));
  assert.equal(content.transforms.length, 1);
  assert.equal(content.transforms[0].match.event, 'workflow_created');
  assert.ok(content.transforms[0].validate.required.includes('workflow_id'));
});

// ─── Custom output path ───

test('custom output path is respected', async () => {
  const dir = tmpDir();
  const plan = makePlanWithEvents([makeEvent('workflow_created')]);
  writeTrackingPlan(dir, plan);

  const outPath = path.join(dir, 'custom-output.json');
  await exportCommand({ cwd: dir, format: 'segment', output: outPath });

  assert.ok(fs.existsSync(outPath), 'custom output path should be used');
});

// ─── No tracking plan ───

test('exportCommand is a no-op when no tracking plan exists', async () => {
  const dir = tmpDir();
  // Should not throw, just log a message
  await exportCommand({ cwd: dir, format: 'segment' });
  assert.ok(!fs.existsSync(path.join(dir, 'segment-tracking-plan.json')), 'should not create file without a plan');
});
