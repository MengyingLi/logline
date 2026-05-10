import { generateTrackingCode, type SynthesizedEvent, type PropertySpec } from 'logline-cli';
import { buildSuggestionComment } from './templates';
import type { DiffFile } from '@/types';

interface ReviewComment {
  path: string;
  line: number;
  side: 'RIGHT';
  commit_id: string;
  body: string;
}

export function buildReview(
  events: SynthesizedEvent[],
  diffs: DiffFile[],
  headSha: string
): { summary: string; comments: ReviewComment[] } {
  const comments: ReviewComment[] = [];

  for (const event of events) {
    const diff = diffs.find((d) => d.path === event.location.file);
    if (!diff) continue;
    const line = resolveCommentLine(event.location.line, diff);
    if (!line) continue;

    const trackingCode = buildTrackingCodeFromEvent(event);

    comments.push({
      path: event.location.file,
      line,
      side: 'RIGHT',
      commit_id: headSha,
      body: buildSuggestionComment(event, trackingCode),
    });
  }

  return {
    summary: buildSummaryComment(events),
    comments,
  };
}

export async function postReview(
  octokit: { request: (route: string, params: Record<string, unknown>) => Promise<unknown> },
  owner: string,
  repo: string,
  prNumber: number,
  events: SynthesizedEvent[],
  diffs: DiffFile[],
  headSha: string
): Promise<void> {
  const { summary, comments } = buildReview(events, diffs, headSha);
  if (comments.length === 0) return;

  await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    owner,
    repo,
    pull_number: prNumber,
    event: 'COMMENT',
    body: summary,
    comments: comments.map((c) => ({
      path: c.path,
      line: c.line,
      side: c.side,
      commit_id: c.commit_id,
      body: c.body,
    })),
  });
}

/** Prefer exact added-line mapping; otherwise nearest added line in the same file diff. */
function resolveCommentLine(sourceLine: number, diff: DiffFile): number | null {
  if (diff.addedLines.includes(sourceLine)) return sourceLine;
  if (diff.addedLines.length > 0) {
    let nearest = diff.addedLines[0];
    let bestDistance = Math.abs(sourceLine - nearest);
    for (const line of diff.addedLines) {
      const distance = Math.abs(sourceLine - line);
      if (distance < bestDistance) {
        nearest = line;
        bestDistance = distance;
      }
    }
    return nearest;
  }
  return null;
}

function buildSummaryComment(events: SynthesizedEvent[]): string {
  const rows = events
    .map((e) => `| \`${e.name}\` | ${e.location.file} | ${emojiForPriority(e.priority)} ${title(e.priority)} |`)
    .join('\n');
  return `## Logline found ${events.length} events to track in this PR

| Event | File | Priority |
|-------|------|----------|
${rows}

Each suggestion below uses GitHub's native format - click **Apply suggestion** to add tracking code.
`;
}

function emojiForPriority(priority: string): string {
  if (priority === 'critical' || priority === 'high') return '🔴';
  if (priority === 'medium') return '🟡';
  return '⚪';
}

function title(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildTrackingCodeFromEvent(event: SynthesizedEvent): string {
  if (event.properties !== undefined) {
    if (event.properties.length > 0) {
      const propsStr = event.properties
        .map((p: PropertySpec) => {
          const val = p.accessPath ?? `${p.name}?.id`;
          const comment = p.todo ? ' // TODO: verify' : '';
          return `  ${p.name}: ${val},${comment}`;
        })
        .join('\n');
      return `track('${event.name}', {\n${propsStr}\n});`;
    }
    const fileName = event.location.file.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? '';
    const hint = fileName ? `check ${fileName} for available fields` : 'add properties from available context';
    return `track('${event.name}', {\n  // TODO: ${hint}\n});`;
  }

  return generateTrackingCode({
    suggestedEvent: event.name,
    reason: event.description,
    confidence: 0.8,
    priority: event.priority,
    location: event.location,
    hint: event.description,
    includes: event.includes,
  });
}
