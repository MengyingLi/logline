import test from 'node:test';
import assert from 'node:assert/strict';
import { apiJsonError } from '../src/lib/api-error';

test('apiJsonError sets status and body shape', async () => {
  const res = apiJsonError('NOT_FOUND', 'missing', 404, 'req-1');
  assert.equal(res.status, 404);
  const json = (await res.json()) as { ok: boolean; code: string; requestId?: string };
  assert.equal(json.ok, false);
  assert.equal(json.code, 'NOT_FOUND');
  assert.equal(json.requestId, 'req-1');
});
