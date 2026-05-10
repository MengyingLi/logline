import test from 'node:test';
import assert from 'node:assert/strict';
import { maskApiKey } from '../src/lib/mask-secret';

test('maskApiKey shortens and masks lk keys', () => {
  const key = 'lk_' + 'a'.repeat(40);
  const m = maskApiKey(key);
  assert.ok(m.includes('…'));
  assert.ok(!m.endsWith(key.slice(-20)));
});
