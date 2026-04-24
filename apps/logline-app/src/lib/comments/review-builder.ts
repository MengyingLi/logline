import { generateTrackingCode, type SynthesizedEvent, type PropertySpec } from 'logline-cli';
import { buildSuggestionComment } from './templates';
import type { DiffFile } from '@/types';

interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

export function buildReview(events: SynthesizedEvent[], diffs: DiffFile[]): { summary: string; comments: ReviewComment[] } {
  const comments: ReviewComment[] = [];

  for (const event of events) {
    const diff = diffs.find((d) => d.path === event.location.file);
    if (!diff) continue;
    const diffLine = mapSourceLineToDiffLine(event.location.line, diff);
    if (!diffLine) continue;

    const trackingCode = buildTrackingCodeFromEvent(event);

    comments.push({
      path: event.location.file,
      line: diffLine,
      body: buildSuggestionComment(event, trackingCode),
    });
  }

  return {
    summary: buildSummaryComment(events),
    comments,
  };
}

export async function postReview(
  octokit: any,
  owner: string,
  repo: string,
  prNumber: number,
  events: SynthesizedEvent[],
  diffs: DiffFile[]
): Promise<void> {
  const { summary, comments } = buildReview(events, diffs);
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
      body: c.body,
    })),
  });
}

function mapSourceLineToDiffLine(sourceLine: number, diff: DiffFile): number | null {
  const mapped = diff.sourceToDiffLine[sourceLine];
  if (typeof mapped === 'number') return mapped;
  // fall back to nearest added source line so comment still anchors in changed hunk
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
    return diff.sourceToDiffLine[nearest] ?? null;
  }
  return null;
}

function buildSummaryComment(events: SynthesizedEvent[]): string {
  const rows = events
    .map((e) => `| \`${e.name}\` | ${e.location.file} | ${emojiForPriority(e.priority)} ${title(e.priority)} |`)
    .join('\n');
  return `## 📊 Logline found ${events.length} events to track in this PR

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

/**
 * Generate the tracking code string for a suggestion comment.
 *
 * Priority:
 *   1. event.properties populated → render exact property accessors (no hallucination)
 *   2. event.properties exists but empty → TODO comment with file hint
 *   3. No properties info → fall back to generateTrackingCode (scope-aware via logline-cli)
 */
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
    // Properties extracted but nothing found — emit a helpful TODO
    const fileName = event.location.file.split('/').pop()?.replace(/\.(ts|tsx|js|jsx)$/, '') ?? '';
    const hint = fileName ? `check ${fileName} for available fields` : 'add properties from available context';
    return `track('${event.name}', {\n  // TODO: ${hint}\n});`;
  }

  // No property extraction info — fall back to logline-cli's scope-aware generator
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

