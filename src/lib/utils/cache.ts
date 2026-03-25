import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { FileContent } from '../types';

export function hashCodebase(files: FileContent[]): string {
  const h = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    h.update(f.path);
    h.update('\0');
    h.update(String(f.content.length));
    h.update('\0');
    // keep it fast: sample first 2kb
    h.update(f.content.slice(0, 2048));
    h.update('\0');
  }
  return h.digest('hex');
}

export function readCache<T>(
  cachePath: string
): { codebaseHash: string; optionsKey: string; version: number; result: T } | null {
  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      codebaseHash: string;
      optionsKey: string;
      version: number;
      result: T;
    };
    if (
      !parsed?.codebaseHash ||
      !parsed?.result ||
      typeof parsed.version !== 'number' ||
      !parsed.optionsKey
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache<T>(
  cachePath: string,
  payload: { codebaseHash: string; optionsKey: string; version: number; result: T }
): void {
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        version: payload.version,
        optionsKey: payload.optionsKey,
        codebaseHash: payload.codebaseHash,
        timestamp: new Date().toISOString(),
        result: payload.result,
      },
      null,
      2
    ),
    'utf-8'
  );
}
