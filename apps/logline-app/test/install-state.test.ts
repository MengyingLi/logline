import test from 'node:test';
import assert from 'node:assert/strict';
import { signInstallState, verifyInstallState } from '../src/lib/install-state';

test('verifyInstallState accepts signed payload', () => {
  process.env.NEXTAUTH_SECRET = 'test-secret-for-signing-at-least-32-bytes';
  const state = signInstallState(42, 120);
  assert.ok(state.length > 0);
  assert.equal(verifyInstallState(42, state), true);
  assert.equal(verifyInstallState(43, state), false);
});
