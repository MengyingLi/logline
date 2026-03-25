import type { FileContent, DetectedEvent, CodeLocation } from '../types';
import type { InventoryResult } from './types';

const FRAMEWORK_PATTERNS: Array<{ framework: string; regex: RegExp }> = [
  { framework: 'segment', regex: /analytics\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { framework: 'segment', regex: /segment\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { framework: 'posthog', regex: /posthog\.capture\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { framework: 'mixpanel', regex: /mixpanel\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
  { framework: 'custom', regex: /\btrack\s*\(\s*['"`]([^'"`]+)['"`]/g },
];

export function runInventory(files: FileContent[]): InventoryResult {
  const byName = new Map<string, DetectedEvent>();
  const entities = new Set<string>();
  const frameworkCounts = new Map<string, number>();

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const p of FRAMEWORK_PATTERNS) {
      let m: RegExpExecArray | null;
      const rx = new RegExp(p.regex.source, p.regex.flags);
      while ((m = rx.exec(file.content)) !== null) {
        const name = m[1];
        const line = file.content.substring(0, m.index).split('\n').length;
        const start = Math.max(0, line - 3);
        const end = Math.min(lines.length, line + 2);
        const loc: CodeLocation = {
          file: file.path,
          line,
          context: lines.slice(start, end).join('\n'),
          confidence: 1,
        };

        const key = name.toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          existing.locations.push(loc);
        } else {
          byName.set(key, { name, framework: p.framework, locations: [loc] });
        }

        // Entity heuristic: prefix before first underscore
        const ent = name.split('_')[0];
        if (ent && ent.length >= 3) entities.add(ent);

        // Count frameworks to detect the dominant one
        frameworkCounts.set(p.framework, (frameworkCounts.get(p.framework) ?? 0) + 1);
      }
    }
  }

  // Determine dominant framework
  let detectedFramework: string | null = null;
  let maxCount = 0;
  for (const [fw, count] of frameworkCounts) {
    if (count > maxCount) {
      maxCount = count;
      detectedFramework = fw;
    }
  }

  return {
    existingEvents: Array.from(byName.values()),
    detectedEntities: Array.from(entities),
    detectedFramework,
  };
}
