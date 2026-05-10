import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReview } from '../src/lib/comments/review-builder';
import type { SynthesizedEvent } from 'logline-cli';
import type { DiffFile } from '../src/types';

const headSha = 'abc123def456';

test('buildReview uses file line, side RIGHT, and commit_id for GitHub review', () => {
  const event = {
    name: 'button_clicked',
    description: 'test',
    priority: 'medium' as const,
    signalType: 'action' as const,
    sourceInteractions: [0],
    location: { file: 'src/Button.tsx', line: 5 },
  } satisfies SynthesizedEvent;
  const diffs: DiffFile[] = [
    {
      path: 'src/Button.tsx',
      status: 'modified',
      patch: '',
      addedLines: [5],
      sourceToDiffLine: { 5: 10 },
      content: '',
    },
  ];
  const { comments } = buildReview([event], diffs, headSha);
  assert.equal(comments.length, 1);
  assert.equal(comments[0]!.line, 5);
  assert.equal(comments[0]!.side, 'RIGHT');
  assert.equal(comments[0]!.commit_id, headSha);
  assert.equal(comments[0]!.path, 'src/Button.tsx');
});

test('buildReview maps to nearest added line when exact line is not in diff', () => {
  const event = {
    name: 'x',
    description: 'd',
    priority: 'low' as const,
    signalType: 'action' as const,
    sourceInteractions: [0],
    location: { file: 'a.ts', line: 99 },
  } satisfies SynthesizedEvent;
  const diffs: DiffFile[] = [
    {
      path: 'a.ts',
      status: 'modified',
      patch: '',
      addedLines: [10, 20],
      sourceToDiffLine: {},
      content: '',
    },
  ];
  const { comments } = buildReview([event], diffs, headSha);
  // Nearest to 99 among [10, 20] is 20.
  assert.equal(comments[0]!.line, 20);
});
