const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTrackingCode } = require('../dist/lib/utils/code-generator.js');

// ─── Helpers ───

function makeGap(suggestedEvent, overrides = {}) {
  return {
    suggestedEvent,
    reason: 'test gap',
    location: { file: 'src/app.ts', line: 10 },
    confidence: 0.8,
    priority: 'high',
    ...overrides,
  };
}

// ─── generateTrackingCode — signal type routing (no file content) ───

test('action signal type → track() call', () => {
  const code = generateTrackingCode(makeGap('workflow_created'), undefined, undefined, { signalType: 'action' });
  assert.ok(code.includes("track('workflow_created'"), `got: ${code}`);
  assert.ok(!code.includes('logger'), `should not include logger, got: ${code}`);
});

test('operation signal type → logger.info() call', () => {
  const code = generateTrackingCode(makeGap('api_called'), undefined, undefined, { signalType: 'operation' });
  assert.ok(code.includes("logger.info('api_called'"), `got: ${code}`);
  assert.ok(!code.includes('track('), `should not include track(), got: ${code}`);
});

test('error signal type → logger.error() call', () => {
  const code = generateTrackingCode(makeGap('payment_failed'), undefined, undefined, { signalType: 'error' });
  assert.ok(code.includes("logger.error('payment_failed'"), `got: ${code}`);
  assert.ok(!code.includes('track('), `should not include track(), got: ${code}`);
});

test('state_change signal type → both track() and logger.info()', () => {
  const code = generateTrackingCode(makeGap('order_status_updated'), undefined, undefined, { signalType: 'state_change' });
  assert.ok(code.includes("track('order_status_updated'"), `got: ${code}`);
  assert.ok(code.includes("logger.info('order_status_updated'"), `got: ${code}`);
});

test('default signal type is action when not specified', () => {
  const code = generateTrackingCode(makeGap('workflow_created'));
  assert.ok(code.includes("track('workflow_created'"), `got: ${code}`);
});

// ─── generateTrackingCode — custom options ───

test('custom functionName replaces track()', () => {
  const code = generateTrackingCode(makeGap('workflow_created'), undefined, undefined, {
    signalType: 'action',
    functionName: 'analytics.track',
  });
  assert.ok(code.includes("analytics.track('workflow_created'"), `got: ${code}`);
});

test('blank functionName falls back to track()', () => {
  const code = generateTrackingCode(makeGap('workflow_created'), undefined, undefined, {
    signalType: 'action',
    functionName: '   ',
  });
  assert.ok(code.includes("track('workflow_created'"), `got: ${code}`);
});

test('custom logger instance name is used', () => {
  const code = generateTrackingCode(makeGap('api_called'), undefined, undefined, {
    signalType: 'operation',
    logging: { importPath: '@/lib/logger', instanceName: 'appLogger' },
  });
  assert.ok(code.includes("appLogger.info('api_called'"), `got: ${code}`);
});

// ─── generateTrackingCode — comment header ───

test('generated code includes logline comment', () => {
  const code = generateTrackingCode(makeGap('workflow_created'));
  assert.ok(code.includes('// Logline:'), `got: ${code}`);
  assert.ok(code.includes('workflow_created'), `got: ${code}`);
});

// ─── generateTrackingCode — _edited events include changes property ───

test('_edited event with includes generates changes array', () => {
  const gap = makeGap('workflow_edited', { includes: ['name', 'description'] });
  const code = generateTrackingCode(gap);
  assert.ok(code.includes('changes'), `got: ${code}`);
  assert.ok(code.includes("'name'"), `got: ${code}`);
  assert.ok(code.includes("'description'"), `got: ${code}`);
});

test('non-edited event does not generate changes property', () => {
  const gap = makeGap('workflow_created', { includes: ['name'] });
  const code = generateTrackingCode(gap);
  assert.ok(!code.includes('changes'), `should not have changes, got: ${code}`);
});

// ─── generateTrackingCode — fallback property inference ───

test('fallback inference: object_id with todo comment', () => {
  const code = generateTrackingCode(makeGap('workflow_created'));
  assert.ok(code.includes('workflow_id'), `should include workflow_id, got: ${code}`);
  assert.ok(code.includes('TODO'), `should include TODO for unverified property, got: ${code}`);
});

test('fallback inference: unknown object name skips object_id', () => {
  const code = generateTrackingCode(makeGap('created'));
  // event parts: ['created'] → objectName = '' → 'unknown'
  assert.ok(!code.includes('unknown_id'), `should not include unknown_id, got: ${code}`);
  assert.ok(code.includes('user_id'), `should still include user_id, got: ${code}`);
});

// ─── generateTrackingCode — with file content (scope inference) ───

test('scope inference: uses workflow variable when present in file', () => {
  const fileContent = `
function createWorkflow(workflow) {
  // do something
}
`;
  const code = generateTrackingCode(makeGap('workflow_created'), fileContent, 3);
  assert.ok(code.includes('workflow_id'), `got: ${code}`);
});

test('scope inference: uses user variable when present in file', () => {
  const fileContent = `
const { user } = useAuth();
function handleSubmit() {
  // track here
}
`;
  const code = generateTrackingCode(makeGap('workflow_created'), fileContent, 4);
  assert.ok(code.includes('user_id'), `got: ${code}`);
  // user comes from scope, so no TODO for user_id
  const lines = code.split('\n');
  const userLine = lines.find((l) => l.includes('user_id'));
  assert.ok(userLine, `user_id line not found in: ${code}`);
});

