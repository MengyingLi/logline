import type { FileContent, CodeLocation } from '../types';
import type { TrackingGap } from '../discovery/tracking-gap-detector';
import { findStatusTransition, inferFileLocation } from '../utils/location-finder';

export async function findBestLocation(
  gap: TrackingGap,
  files: FileContent[],
  deep: boolean
): Promise<CodeLocation> {
  // Strategy 1: Status transitions (lifecycle suffixes)
  const m = gap.suggestedEvent.match(/_(started|completed|failed|accepted|rejected)$/);
  if (m) {
    const statusValue = m[1];
    const entityName = gap.suggestedEvent.replace(/_\w+$/, '');
    const matches = findStatusTransition(files, statusValue, entityName);
    if (matches.length > 0) {
      const best = matches[0];
      return {
        file: best.file,
        line: best.line,
        context: best.context,
        confidence: best.confidence,
        hint: 'status_transition',
      };
    }
  }

  // Strategy 2: Search patterns from gap
  if (gap.searchPatterns?.length) {
    for (const pattern of gap.searchPatterns) {
      const loc = firstMatchLocation(files, pattern);
      if (loc) return loc;
    }
  }

  // Strategy 3: Infer from event name
  const inferred = inferFileLocation(gap.suggestedEvent, files);
  if (inferred) {
    return {
      file: inferred.file,
      line: inferred.line,
      confidence: inferred.confidence,
      hint: 'inferred',
    };
  }

  // Strategy 4: LLM suggestion (placeholder, only when deep)
  if (deep) {
    // Not implemented here (would require a second LLM prompt scoped to files + gap)
  }

  return { file: 'unknown', line: 0, confidence: 0.1, hint: 'unknown' };
}

export function firstMatchLocation(files: FileContent[], needle: string): CodeLocation | null {
  for (const file of files) {
    const idx = file.content.indexOf(needle);
    if (idx === -1) continue;
    const lines = file.content.split('\n');
    const line = file.content.substring(0, idx).split('\n').length; // 1-indexed
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);
    return {
      file: file.path,
      line,
      context: lines.slice(start, end).join('\n'),
      confidence: 0.5,
      hint: `match:${needle}`,
    };
  }
  return null;
}
