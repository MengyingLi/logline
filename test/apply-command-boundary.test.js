/**
 * CLI boundary: applyCommand exits cleanly when no tracking plan exists (plan §10 test expansion).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { applyCommand } = require('../dist/commands/apply.js');

test('applyCommand single-event mode returns without throwing when plan is missing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logline-apply-boundary-'));
  await assert.doesNotReject(async () => {
    await applyCommand({ cwd: tmp, eventName: 'any_event' });
  });
});
