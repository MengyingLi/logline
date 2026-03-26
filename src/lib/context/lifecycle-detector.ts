import type { FileContent, ObjectLifecycle } from '../types';

/**
 * Minimal lifecycle detector (Week 3 Day 15-16).
 * Detects enum/union-based status state lists. Transition inference is deferred.
 */
export function detectLifecycles(files: FileContent[]): ObjectLifecycle[] {
  const out: ObjectLifecycle[] = [];

  for (const f of files) {
    const c = f.content;

    for (const m of c.matchAll(/\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)\}/g)) {
      const enumName = m[1];
      if (!/Status$|State$/i.test(enumName)) continue;
      const body = m[2] ?? '';
      const states = body
        .split(/[,\\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/=.*/, '').trim())
        .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))
        .map((s) => s.toLowerCase());
      if (states.length === 0) continue;

      const object = enumName.replace(/(Status|State)$/i, '');
      out.push({ object, states: Array.from(new Set(states)), transitions: [] });
    }

    for (const m of c.matchAll(/\btype\s+([A-Za-z_][A-Za-z0-9_]*)(Status|State)\s*=\s*([^;]+);/g)) {
      const object = m[1];
      const rhs = m[3] ?? '';
      const states = rhs
        .split('|')
        .map((s) => s.trim())
        .map((s) => s.replace(/^['"]|['"]$/g, ''))
        .filter((s) => /^[a-z0-9_-]{3,30}$/i.test(s))
        .map((s) => s.toLowerCase());
      if (states.length === 0) continue;
      out.push({ object, states: Array.from(new Set(states)), transitions: [] });
    }
  }

  const byObject = new Map<string, ObjectLifecycle>();
  for (const lc of out) {
    const key = lc.object.toLowerCase();
    const existing = byObject.get(key);
    if (!existing) byObject.set(key, lc);
    else existing.states = Array.from(new Set([...(existing.states ?? []), ...(lc.states ?? [])]));
  }
  return Array.from(byObject.values());
}

