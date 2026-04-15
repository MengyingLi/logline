export interface InstallationContext {
  installationId: number;
  owner: string;
  repo: string;
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'removed';
  patch: string;
  addedLines: number[];
  sourceToDiffLine: Record<number, number>;
  content?: string;
}

