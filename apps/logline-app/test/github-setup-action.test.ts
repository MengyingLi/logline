import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedInstallSetupAction } from '../src/lib/github';

test('install setup_action variants', () => {
  assert.equal(isAllowedInstallSetupAction(null), true);
  assert.equal(isAllowedInstallSetupAction(''), true);
  assert.equal(isAllowedInstallSetupAction('install'), true);
  assert.equal(isAllowedInstallSetupAction('update'), true);
  assert.equal(isAllowedInstallSetupAction('malicious'), false);
});
