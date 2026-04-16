const test = require('node:test');
const assert = require('node:assert/strict');
const { inferSignalType } = require('../dist/lib/pipeline/05-synthesize-events.js');
const { generateTrackingCode } = require('../dist/lib/utils/code-generator.js');

// ─── inferSignalType ───

test('click_handler → action', () => {
  assert.equal(inferSignalType('click_handler'), 'action');
});

test('form_submit → action', () => {
  assert.equal(inferSignalType('form_submit'), 'action');
});

test('route_handler → action', () => {
  assert.equal(inferSignalType('route_handler'), 'action');
});

test('mutation → action', () => {
  assert.equal(inferSignalType('mutation'), 'action');
});

test('toggle → action', () => {
  assert.equal(inferSignalType('toggle'), 'action');
});

test('lifecycle → state_change', () => {
  assert.equal(inferSignalType('lifecycle'), 'state_change');
});

test('state_change → state_change', () => {
  assert.equal(inferSignalType('state_change'), 'state_change');
});

test('error_boundary → error', () => {
  assert.equal(inferSignalType('error_boundary'), 'error');
});

test('api_call → operation', () => {
  assert.equal(inferSignalType('api_call'), 'operation');
});

test('retry_logic → operation', () => {
  assert.equal(inferSignalType('retry_logic'), 'operation');
});

test('job_handler → operation', () => {
  assert.equal(inferSignalType('job_handler'), 'operation');
});

test('undefined → action (default)', () => {
  assert.equal(inferSignalType(undefined), 'action');
});

// ─── generateTrackingCode ───

const baseGap = {
  suggestedEvent: 'workflow_created',
  reason: 'test',
  location: { file: 'src/app.ts', line: 10 },
  confidence: 0.8,
  priority: 'high',
};

test('action → track()', () => {
  const code = generateTrackingCode(baseGap, undefined, undefined, { signalType: 'action' });
  assert.ok(code.includes("track('workflow_created'"), `got: ${code}`);
  assert.ok(!code.includes('logger'), `should not include logger for action: ${code}`);
});

test('operation → logger.info()', () => {
  const code = generateTrackingCode(baseGap, undefined, undefined, { signalType: 'operation' });
  assert.ok(code.includes("logger.info('workflow_created'"), `got: ${code}`);
  assert.ok(!code.includes('track('), `should not include track() for operation: ${code}`);
});

test('error → logger.error()', () => {
  const code = generateTrackingCode(baseGap, undefined, undefined, { signalType: 'error' });
  assert.ok(code.includes("logger.error('workflow_created'"), `got: ${code}`);
});

test('state_change → both track() and logger.info()', () => {
  const code = generateTrackingCode(baseGap, undefined, undefined, { signalType: 'state_change' });
  assert.ok(code.includes("track('workflow_created'"), `got: ${code}`);
  assert.ok(code.includes("logger.info('workflow_created'"), `got: ${code}`);
});

test('custom logger instance name', () => {
  const code = generateTrackingCode(baseGap, undefined, undefined, {
    signalType: 'error',
    logging: { importPath: '@/lib/logger', instanceName: 'appLogger' },
  });
  assert.ok(code.includes("appLogger.error('workflow_created'"), `got: ${code}`);
});

test('scan output includes signalType for detected interactions', async () => {
  const path = require('node:path');
  const fs = require('node:fs');
  const os = require('node:os');
  const { scanCommand } = require('../dist/commands/scan.js');

  // Use react-spa fixture which has click handlers
  const fixtureRoot = path.join(process.cwd(), 'test', 'fixtures');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-signaltype-'));
  // Copy fixture
  function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      if (entry.name === '.logline') continue; // never copy cache
      const s = path.join(src, entry.name);
      const d = path.join(dst, entry.name);
      if (entry.isDirectory()) copyDir(s, d);
      else fs.copyFileSync(s, d);
    }
  }
  copyDir(path.join(fixtureRoot, 'react-spa'), tmp);

  const result = await scanCommand({ cwd: tmp, fast: true });
  const allGaps = result.gaps ?? [];
  assert.ok(allGaps.length > 0, 'should have gaps');
  assert.ok(
    allGaps.every(g => ['action', 'operation', 'state_change', 'error'].includes(g.signalType)),
    `all gaps should have a valid signalType, got: ${JSON.stringify(allGaps.map(g => g.signalType))}`
  );
});
