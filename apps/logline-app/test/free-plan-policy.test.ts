import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FREE_REPO_LIMIT, freePlanAllowsRepoAnalysis } from '../src/lib/billing/free-plan-policy';

test('free plan allows already-enrolled repo regardless of count', () => {
  assert.equal(
    freePlanAllowsRepoAnalysis({
      enrolledRepoCount: 99,
      existingRepoEnrolled: true,
      freeRepoLimit: DEFAULT_FREE_REPO_LIMIT,
    }),
    true
  );
});

test('free plan blocks new repo when at capacity', () => {
  assert.equal(
    freePlanAllowsRepoAnalysis({
      enrolledRepoCount: DEFAULT_FREE_REPO_LIMIT,
      existingRepoEnrolled: false,
      freeRepoLimit: DEFAULT_FREE_REPO_LIMIT,
    }),
    false
  );
});

test('free plan allows new repo when under capacity', () => {
  assert.equal(
    freePlanAllowsRepoAnalysis({
      enrolledRepoCount: 2,
      existingRepoEnrolled: false,
      freeRepoLimit: DEFAULT_FREE_REPO_LIMIT,
    }),
    true
  );
});
