const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, 'dist', 'cli.js');
const fixtureRoot = path.join(repoRoot, 'test', 'fixtures');

test('day14: scan → spec → approve → pr --dry-run on all fixtures', async () => {
  for (const fixture of ['nextjs-saas', 'express-api', 'react-spa']) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `logline-e2e-${fixture}-`));
    copyDir(path.join(fixtureRoot, fixture), tmp);

    // init creates .logline/config.json + tracking plan
    runCli(tmp, ['init']);

    // overwrite config to validate Day 12-13 wiring (import path + function name)
    const cfgPath = path.join(tmp, '.logline', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    cfg.tracking = cfg.tracking || {};
    cfg.tracking.importPath = '@/lib/custom-analytics';
    cfg.tracking.functionName = 'capture';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    // scan fast should run and be json-parseable
    const scan = runCli(tmp, ['scan', '--fast', '--json'], { quiet: true });
    assert.doesNotThrow(() => JSON.parse(scan.stdout));

    // spec produces tracking plan
    runCli(tmp, ['spec']);

    // approve all suggested
    runCli(tmp, ['approve', '--all']);

    // status should run
    runCli(tmp, ['status']);

    const planPath = path.join(tmp, '.logline', 'tracking-plan.json');
    const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'));
    const toInstrument = (plan.events || []).filter((e) => e.status === 'suggested' || e.status === 'approved');

    const pr = runCli(tmp, ['pr', '--dry-run'], { quiet: true });
    if (toInstrument.length === 0) {
      assert.match(pr.stdout, /No missing analytics events found/i);
    } else {
      // pr dry-run should reference configured import/functionName
      assert.match(pr.stdout, /import\s+\{\s*capture\s*\}\s+from\s+['"]@\/lib\/custom-analytics['"];/);
      assert.match(pr.stdout, /\bcapture\('.*_.*',\s*\{/);
    }
  }
});

function runCli(cwd, args, opts) {
  const quiet = Boolean(opts && opts.quiet);
  const res = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: '' }, // keep tests offline/deterministic
  });
  if (!quiet) {
    process.stdout.write(res.stdout || '');
    process.stderr.write(res.stderr || '');
  }
  if (res.status !== 0) {
    const msg = `cli failed: ${args.join(' ')}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`;
    throw new Error(msg);
  }
  return { stdout: res.stdout || '', stderr: res.stderr || '' };
}

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

