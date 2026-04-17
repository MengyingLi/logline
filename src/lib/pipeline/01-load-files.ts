import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import type { FileContent } from '../types';

export async function loadCodebaseFiles(
  rootDir: string,
  options?: { include?: string[]; exclude?: string[] }
): Promise<FileContent[]> {
  const patterns =
    options?.include && options.include.length > 0
      ? options.include
      : ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.md', '**/package.json'];
  const ignore = [
    '**/node_modules/**',
    '**/.next/**',
    '**/dist/**',
    '**/build/**',
    '**/.git/**',
    '**/coverage/**',
    '**/conventions/**',
    '**/.logline/**',
    ...(options?.exclude ?? []),
  ];

  const fileSet = new Set<string>();
  for (const pat of patterns) {
    const matches = await glob(pat, { cwd: rootDir, ignore, absolute: true });
    for (const m of matches) fileSet.add(m);
  }

  const files: FileContent[] = [];
  for (const abs of fileSet) {
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      files.push({ path: path.relative(rootDir, abs), content });
    } catch {
      // ignore unreadable files
    }
  }
  return files;
}
