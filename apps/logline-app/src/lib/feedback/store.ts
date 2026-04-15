import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AcceptedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  timestamp: string;
}

export interface RejectedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  reason?: string;
  timestamp: string;
}

export interface RepoFeedback {
  repoFullName: string;
  accepted: AcceptedEvent[];
  rejected: RejectedEvent[];
}

const memory = new Map<string, RepoFeedback>();
const storePath = process.env.LOGLINE_FEEDBACK_STORE_PATH
  ? path.resolve(process.env.LOGLINE_FEEDBACK_STORE_PATH)
  : path.resolve(process.cwd(), '.logline-app-feedback.json');

let hydrated = false;

export function getRepoFeedback(repoFullName: string): RepoFeedback {
  hydrateFromDiskIfNeeded();
  const existing = memory.get(repoFullName);
  if (existing) return existing;
  const initial: RepoFeedback = { repoFullName, accepted: [], rejected: [] };
  memory.set(repoFullName, initial);
  persistToDiskBestEffort();
  return initial;
}

export function recordAccepted(repoFullName: string, accepted: AcceptedEvent): void {
  const current = getRepoFeedback(repoFullName);
  current.accepted.push(accepted);
  persistToDiskBestEffort();
}

export function recordRejected(repoFullName: string, rejected: RejectedEvent): void {
  const current = getRepoFeedback(repoFullName);
  current.rejected.push(rejected);
  persistToDiskBestEffort();
}

function hydrateFromDiskIfNeeded(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    if (!fs.existsSync(storePath)) return;
    const raw = fs.readFileSync(storePath, 'utf8');
    const parsed = JSON.parse(raw) as { repos?: RepoFeedback[] };
    for (const repoFeedback of parsed.repos ?? []) {
      if (repoFeedback?.repoFullName) {
        memory.set(repoFeedback.repoFullName, {
          repoFullName: repoFeedback.repoFullName,
          accepted: Array.isArray(repoFeedback.accepted) ? repoFeedback.accepted : [],
          rejected: Array.isArray(repoFeedback.rejected) ? repoFeedback.rejected : [],
        });
      }
    }
  } catch (err) {
    console.warn('[logline-app] feedback store hydrate failed:', err);
  }
}

function persistToDiskBestEffort(): void {
  try {
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload = {
      updatedAt: new Date().toISOString(),
      repos: Array.from(memory.values()),
    };
    fs.writeFileSync(storePath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    // In serverless/readonly environments, fall back to in-memory only.
    console.warn('[logline-app] feedback store persist skipped:', err);
  }
}

