/**
 * Location finder utilities (ported from logline_old/packages/cli/src/utils/location-finder.ts)
 */

import type { FileContent } from '../types';

export interface LocationMatch {
  file: string;
  line: number;
  context: string;
  isRuntime: boolean;
  confidence: number;
}

export interface ContextAnalysis {
  variables: Array<{
    name: string;
    type?: string;
    source: string;
    line?: number;
  }>;
  functions: Array<{
    name: string;
    parameters: string[];
  }>;
}

/**
 * Find locations where status transitions happen (runtime code, not type definitions)
 */
export function findStatusTransition(
  files: FileContent[],
  statusValue: string,
  entityName?: string
): LocationMatch[] {
  const matches: LocationMatch[] = [];

  const status = escapeRegExp(statusValue);

  const patterns = [
    { regex: new RegExp(`\\.update\\(\\s*\\{\\s*status\\s*:\\\s*['"\`]${status}['"\`]\\s*\\}\\s*\\)`, 'g'), name: 'update-status' },
    { regex: new RegExp(`return\\s+\\{[\\s\\S]*?status\\s*:\\s*['"\`]${status}['"\`][\\s\\S]*?\\}`, 'g'), name: 'return-status' },
    { regex: new RegExp(`(\\w+)\\.status\\s*=\\s*['"\`]${status}['"\`]`, 'g'), name: 'assignment' },
  ];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      while ((match = regex.exec(file.content)) !== null) {
        const lineNumber = getLineNumber(file.content, match.index);
        if (!isRuntimeCode(file.content, match.index, lineNumber)) continue;

        const context = extractContext(lines, lineNumber, 3);
        const line = lines[lineNumber] ?? '';

        matches.push({
          file: file.path,
          line: lineNumber + 1,
          context,
          isRuntime: true,
          confidence: calculateConfidence(pattern.name, line, entityName),
        });
      }
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence);
  return matches;
}

export function analyzeContext(lines: string[], insertLine: number, fullContent: string): ContextAnalysis {
  const variables: ContextAnalysis['variables'] = [];
  const functions: ContextAnalysis['functions'] = [];

  // Look backwards a bit for variable declarations and function params
  const start = Math.max(0, insertLine - 50);
  const end = Math.min(lines.length - 1, insertLine + 10);
  const window = lines.slice(start, end + 1);

  // Destructuring: const { a, b } = ...
  for (let i = 0; i < window.length; i++) {
    const line = window[i];
    const m = line.match(/const\\s+\\{([^}]+)\\}\\s*=\\s*(\\w+)/);
    if (m) {
      const names = m[1]
        .split(',')
        .map((s) => s.trim().split(':')[0].trim())
        .filter(Boolean);
      for (const name of names) {
        variables.push({ name, source: 'destructured', line: start + i + 1 });
      }
    }
  }

  // Simple const/let: const foo = ...
  for (let i = 0; i < window.length; i++) {
    const line = window[i];
    const m = line.match(/\\b(const|let)\\s+(\\w+)\\s*=/);
    if (m) {
      variables.push({ name: m[2], source: 'variable', line: start + i + 1 });
    }
  }

  // Function params: function name(a, b) OR const name = (a,b) =>
  for (let i = 0; i < window.length; i++) {
    const line = window[i];
    const fn = line.match(/function\\s+(\\w+)\\s*\\(([^)]*)\\)/);
    if (fn) {
      functions.push({
        name: fn[1],
        parameters: fn[2].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean),
      });
    }
    const arrow = line.match(/const\\s+(\\w+)\\s*=\\s*\\(([^)]*)\\)\\s*=>/);
    if (arrow) {
      functions.push({
        name: arrow[1],
        parameters: arrow[2].split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean),
      });
    }
  }

  // Deduplicate variables by name (keep first occurrence)
  const seen = new Set<string>();
  const dedupedVars = variables.filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });

  return { variables: dedupedVars, functions };
}

// Very lightweight heuristic: infer file likely to contain event
export function inferFileLocation(eventName: string, files: FileContent[]): { file: string; line: number; confidence: number } | null {
  const eventLower = eventName.toLowerCase();

  const pick = (pred: (f: FileContent) => boolean) => files.find(pred)?.path;

  if (eventLower.includes('scan')) {
    const f = pick((f) => f.path.includes('scan') && (f.path.includes('service') || f.path.includes('route') || f.path.includes('api')));
    if (f) return { file: f, line: 1, confidence: 0.3 };
  }

  if (eventLower.includes('user') || eventLower.includes('auth') || eventLower.includes('login') || eventLower.includes('signup')) {
    const f = pick((f) => f.path.includes('auth') || f.path.includes('user'));
    if (f) return { file: f, line: 1, confidence: 0.3 };
  }

  if (eventLower.includes('workflow')) {
    const f = pick((f) => f.path.includes('workflow') || f.path.includes('workflows'));
    if (f) return { file: f, line: 1, confidence: 0.25 };
  }

  return null;
}

function isRuntimeCode(content: string, matchIndex: number, lineNumber: number): boolean {
  const lines = content.split('\n');
  const lookBack = Math.max(0, lineNumber - 6);
  const lookAhead = Math.min(lines.length - 1, lineNumber + 2);
  const window = lines.slice(lookBack, lookAhead + 1).join('\n');

  // Heuristic: type/iface blocks likely not runtime
  if (/\binterface\b|\btype\b/.test(window)) return false;
  if (/:\s*['"`]?[a-zA-Z_]+['"`]?\s*(\||;|,)/.test(window)) return false;
  return true;
}

function calculateConfidence(patternName: string, line: string, entityName?: string): number {
  let score = 0.5;
  if (patternName === 'update-status') score += 0.2;
  if (patternName === 'assignment') score += 0.1;
  if (entityName && line.toLowerCase().includes(entityName.toLowerCase())) score += 0.1;
  return Math.max(0, Math.min(1, score));
}

function extractContext(lines: string[], lineNumber: number, radius: number): string {
  const start = Math.max(0, lineNumber - radius);
  const end = Math.min(lines.length - 1, lineNumber + radius);
  return lines.slice(start, end + 1).join('\n');
}

function getLineNumber(content: string, index: number): number {
  return content.substring(0, index).split('\n').length - 1;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

