const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readLoglineConfig, getDefaultConfig, getConfigPath } = require('../dist/lib/utils/config.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logline-cfg-'));
}

function writeConfig(dir, content) {
  fs.mkdirSync(path.join(dir, '.logline'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.logline', 'config.json'), typeof content === 'string' ? content : JSON.stringify(content));
}

// ─── getDefaultConfig ───

test('getDefaultConfig returns expected defaults', () => {
  const cfg = getDefaultConfig();
  assert.equal(cfg.eventGranularity, 'business');
  assert.equal(cfg.tracking.destination, 'custom');
  assert.equal(cfg.tracking.importPath, '@/lib/analytics');
  assert.equal(cfg.tracking.functionName, 'track');
  assert.ok(Array.isArray(cfg.scan.include));
  assert.ok(cfg.scan.include.length > 0);
});

// ─── getConfigPath ───

test('getConfigPath returns .logline/config.json path', () => {
  assert.equal(getConfigPath('/project'), path.join('/project', '.logline', 'config.json'));
});

// ─── readLoglineConfig — missing file ───

test('returns defaults when config file does not exist', () => {
  const dir = tmpDir();
  const cfg = readLoglineConfig(dir);
  const defaults = getDefaultConfig();
  assert.equal(cfg.eventGranularity, defaults.eventGranularity);
  assert.equal(cfg.tracking.destination, defaults.tracking.destination);
  assert.equal(cfg.tracking.importPath, defaults.tracking.importPath);
  assert.deepEqual(cfg.scan.include, defaults.scan.include);
});

// ─── readLoglineConfig — malformed JSON ───

test('throws with helpful message on malformed JSON', () => {
  const dir = tmpDir();
  writeConfig(dir, '{ "eventGranularity": "business", oops }');
  assert.throws(() => readLoglineConfig(dir), /Invalid config\.json/);
});

// ─── readLoglineConfig — valid full config ───

test('reads valid config correctly', () => {
  const dir = tmpDir();
  writeConfig(dir, {
    eventGranularity: 'granular',
    tracking: { destination: 'segment', importPath: '@/lib/segment', functionName: 'segmentTrack' },
    scan: { include: ['app/**/*.ts'], exclude: ['**/*.spec.ts'] },
  });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.eventGranularity, 'granular');
  assert.equal(cfg.tracking.destination, 'segment');
  assert.equal(cfg.tracking.importPath, '@/lib/segment');
  assert.equal(cfg.tracking.functionName, 'segmentTrack');
  assert.deepEqual(cfg.scan.include, ['app/**/*.ts']);
  assert.deepEqual(cfg.scan.exclude, ['**/*.spec.ts']);
});

// ─── readLoglineConfig — partial config falls back to defaults ───

test('partial config merges with defaults', () => {
  const dir = tmpDir();
  writeConfig(dir, { tracking: { importPath: '@/lib/custom-analytics' } });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.eventGranularity, 'business', 'missing field falls back to default');
  assert.equal(cfg.tracking.importPath, '@/lib/custom-analytics', 'provided field is used');
  assert.equal(cfg.tracking.destination, 'custom', 'missing tracking field falls back to default');
});

// ─── readLoglineConfig — invalid values fall back to defaults ───

test('invalid tracking.destination falls back to default', () => {
  const dir = tmpDir();
  writeConfig(dir, { tracking: { destination: 'firebase' } });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.tracking.destination, 'custom');
});

test('invalid eventGranularity falls back to business', () => {
  const dir = tmpDir();
  writeConfig(dir, { eventGranularity: 'super-granular' });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.eventGranularity, 'business');
});

test('blank importPath falls back to default', () => {
  const dir = tmpDir();
  writeConfig(dir, { tracking: { importPath: '   ' } });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.tracking.importPath, '@/lib/analytics');
});

// ─── readLoglineConfig — logging section ───

test('logging section is undefined when not in config', () => {
  const dir = tmpDir();
  writeConfig(dir, {});
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.logging, undefined);
});

test('logging section is read correctly', () => {
  const dir = tmpDir();
  writeConfig(dir, {
    logging: { destination: 'pino', importPath: '@/lib/logger', instanceName: 'log' },
  });
  const cfg = readLoglineConfig(dir);
  assert.ok(cfg.logging, 'logging should be present');
  assert.equal(cfg.logging.destination, 'pino');
  assert.equal(cfg.logging.importPath, '@/lib/logger');
  assert.equal(cfg.logging.instanceName, 'log');
});

test('invalid logging.destination falls back to console', () => {
  const dir = tmpDir();
  writeConfig(dir, { logging: { destination: 'splunk', importPath: '@/lib/logger', instanceName: 'logger' } });
  const cfg = readLoglineConfig(dir);
  assert.equal(cfg.logging.destination, 'console');
});

test('all valid logging destinations are accepted', () => {
  for (const dest of ['pino', 'winston', 'datadog', 'console']) {
    const dir = tmpDir();
    writeConfig(dir, { logging: { destination: dest, importPath: '@/lib/logger', instanceName: 'logger' } });
    const cfg = readLoglineConfig(dir);
    assert.equal(cfg.logging.destination, dest, `${dest} should be accepted`);
  }
});

// ─── readLoglineConfig — scan globs ───

test('empty scan.include array falls back to defaults', () => {
  const dir = tmpDir();
  writeConfig(dir, { scan: { include: [] } });
  const cfg = readLoglineConfig(dir);
  assert.deepEqual(cfg.scan.include, getDefaultConfig().scan.include);
});

test('scan.include filters out non-string values', () => {
  const dir = tmpDir();
  writeConfig(dir, { scan: { include: ['src/**/*.ts', null, 42, ''] } });
  const cfg = readLoglineConfig(dir);
  assert.deepEqual(cfg.scan.include, ['src/**/*.ts']);
});

test('scan.exclude can be empty array', () => {
  const dir = tmpDir();
  writeConfig(dir, { scan: { include: ['src/**/*.ts'], exclude: [] } });
  const cfg = readLoglineConfig(dir);
  assert.deepEqual(cfg.scan.exclude, []);
});

// ─── readLoglineConfig — null/empty JSON ───

test('null JSON content returns defaults', () => {
  const dir = tmpDir();
  writeConfig(dir, 'null');
  const cfg = readLoglineConfig(dir);
  const defaults = getDefaultConfig();
  assert.equal(cfg.tracking.destination, defaults.tracking.destination);
});
