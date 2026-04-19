import type { FileContent } from 'logline-cli';
import type { Octokit } from 'octokit';
import type { DiffFile } from '@/types';

export async function parsePRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  ref?: string
): Promise<{ files: FileContent[]; diffs: DiffFile[] }> {
  const changedFiles = await listChangedFiles(octokit, owner, repo, prNumber);

  const files: FileContent[] = [];
  const diffs: DiffFile[] = [];

  for (const f of changedFiles) {
    const status = (f.status === 'added' || f.status === 'modified' || f.status === 'removed'
      ? f.status
      : 'modified') as DiffFile['status'];
    const patch = f.patch ?? '';
    const { addedLines, sourceToDiffLine } = collectAddedLinesFromPatch(patch);

    let content: string | undefined = undefined;
    if (status !== 'removed' && isSourceFile(f.filename)) {
      try {
        const contentRes = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
          owner,
          repo,
          path: f.filename,
          ref,
        });
        const data = contentRes.data as any;
        if (typeof data?.content === 'string') {
          content = Buffer.from(data.content, 'base64').toString('utf8');
          files.push({ path: f.filename, content });
        }
      } catch {
        // skip file if we cannot fetch content
      }
    }

    diffs.push({
      path: f.filename,
      status,
      patch,
      addedLines,
      sourceToDiffLine,
      content,
    });
  }

  return { files, diffs };
}

async function listChangedFiles(octokit: Octokit, owner: string, repo: string, prNumber: number) {
  const files: Array<{ filename: string; status: string; patch?: string }> = [];
  let page = 1;
  while (page <= 10) {
    const res = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    });
    files.push(...res.data.map((f) => ({ filename: f.filename, status: f.status, patch: f.patch ?? undefined })));
    if (res.data.length < 100) break;
    page += 1;
  }
  return files;
}

function collectAddedLinesFromPatch(patch: string): { addedLines: number[]; sourceToDiffLine: Record<number, number> } {
  const added: number[] = [];
  const sourceToDiffLine: Record<number, number> = {};
  let rightLine = 0;
  let diffLine = 0;
  for (const line of patch.split('\n')) {
    diffLine += 1;
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      rightLine = Number(hunk[1]);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push(rightLine);
      sourceToDiffLine[rightLine] = diffLine;
      rightLine += 1;
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      continue;
    }
    if (!line.startsWith('\\')) {
      rightLine += 1;
    }
  }
  return { addedLines: added, sourceToDiffLine };
}

function isSourceFile(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(filePath);
}

