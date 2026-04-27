// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

// ─── Client ──────────────────────────────────────────────────────────────────

// Using `any` schema type intentionally — we don't generate types until the
// Supabase project is linked. All table operations cast to the appropriate
// typed interface at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>;

function makeClient(): AnyClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<any>(url, key);
}

let _db: AnyClient | null = null;
export function getDb(): AnyClient {
  if (!_db) _db = makeClient();
  return _db;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Installation {
  id: number;
  account_login: string;
  account_type: string;
  plan: 'free' | 'pro' | 'enterprise';
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  installed_at: string;
  suspended_at: string | null;
}

export interface Repo {
  id: number;
  installation_id: number;
  owner: string;
  name: string;
  tracking_plan: unknown | null;
  tracking_plan_updated_at: string | null;
  fanout_config: FanoutConfig | null;
  enrolled_at: string;
}

export interface FanoutConfig {
  segment?: { writeKey: string };
  posthog?: { apiKey: string; host?: string };
  mixpanel?: { token: string };
  amplitude?: { apiKey: string };
  custom?: { url: string; headers?: Record<string, string> };
}

export interface ApiKey {
  id: number;
  repo_id: number;
  name: string;
  key: string;
  created_at: string;
  revoked_at: string | null;
}

export interface DbEvent {
  id: number;
  repo_id: number;
  event_name: string;
  properties: Record<string, unknown> | null;
  environment: string;
  received_at: string;
}

// ─── Installations ────────────────────────────────────────────────────────────

export async function upsertInstallation(
  data: Pick<Installation, 'id' | 'account_login' | 'account_type'>
): Promise<void> {
  const { error } = await getDb()
    .from('installations')
    .upsert({ ...data, plan: 'free' }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function getInstallation(id: number): Promise<Installation | null> {
  const { data, error } = await getDb()
    .from('installations')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Installation | null;
}

export async function getInstallationByLogin(login: string): Promise<Installation | null> {
  const { data, error } = await getDb()
    .from('installations')
    .select('*')
    .eq('account_login', login)
    .maybeSingle();
  if (error) throw error;
  return data as Installation | null;
}

// ─── Repos ───────────────────────────────────────────────────────────────────

/** Enroll a repo, creating a default API key, idempotent. */
export async function enrollRepo(
  installationId: number,
  owner: string,
  name: string
): Promise<Repo> {
  const db = getDb();

  // Upsert repo row
  const { data: repo, error } = await db
    .from('repos')
    .upsert(
      { installation_id: installationId, owner, name },
      { onConflict: 'owner,name', ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();
  if (error) throw error;

  // Fetch if upsert ignored (already existed)
  const r = repo ?? (await getRepo(owner, name));
  if (!r) throw new Error(`Repo ${owner}/${name} not found after enroll`);

  // Ensure at least one API key exists
  const { data: existingKeys } = await db
    .from('api_keys')
    .select('id')
    .eq('repo_id', r.id)
    .is('revoked_at', null)
    .limit(1);

  if (!existingKeys?.length) {
    await createApiKey(r.id, 'default');
  }

  return r as Repo;
}

export async function getRepo(owner: string, name: string): Promise<Repo | null> {
  const { data, error } = await getDb()
    .from('repos')
    .select('*')
    .eq('owner', owner)
    .eq('name', name)
    .maybeSingle();
  if (error) throw error;
  return data as Repo | null;
}

export async function getRepoById(id: number): Promise<Repo | null> {
  const { data, error } = await getDb()
    .from('repos')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as Repo | null;
}

export async function getReposByInstallation(installationId: number): Promise<Repo[]> {
  const { data, error } = await getDb()
    .from('repos')
    .select('*')
    .eq('installation_id', installationId)
    .order('enrolled_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as Repo[];
}

export async function updateTrackingPlan(
  owner: string,
  name: string,
  plan: unknown
): Promise<void> {
  const { error } = await getDb()
    .from('repos')
    .update({ tracking_plan: plan, tracking_plan_updated_at: new Date().toISOString() })
    .eq('owner', owner)
    .eq('name', name);
  if (error) throw error;
}

// ─── API Keys ─────────────────────────────────────────────────────────────────

export async function createApiKey(repoId: number, name: string): Promise<ApiKey> {
  const key = `lk_${randomBytes(24).toString('hex')}`;
  const { data, error } = await getDb()
    .from('api_keys')
    .insert({ repo_id: repoId, name, key })
    .select()
    .single();
  if (error) throw error;
  return data as ApiKey;
}

export async function resolveApiKey(key: string): Promise<{ repoId: number; repo: Repo } | null> {
  const { data, error } = await getDb()
    .from('api_keys')
    .select('repo_id')
    .eq('key', key)
    .is('revoked_at', null)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const repo = await getRepoById(data.repo_id);
  if (!repo) return null;
  return { repoId: data.repo_id, repo };
}

export async function getApiKeysForRepo(repoId: number): Promise<ApiKey[]> {
  const { data, error } = await getDb()
    .from('api_keys')
    .select('*')
    .eq('repo_id', repoId)
    .is('revoked_at', null)
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as ApiKey[];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export async function insertEvent(
  repoId: number,
  eventName: string,
  properties: Record<string, unknown> | null,
  environment = 'production'
): Promise<void> {
  const { error } = await getDb().from('events').insert({
    repo_id: repoId,
    event_name: eventName,
    properties,
    environment,
  });
  if (error) throw error;
}

/** Returns event counts per name for the last N days. */
export async function getEventCounts(
  repoId: number,
  days = 30
): Promise<Array<{ event_name: string; count: number; last_seen: string }>> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data, error } = await getDb()
    .from('events')
    .select('event_name, received_at')
    .eq('repo_id', repoId)
    .gte('received_at', since)
    .order('received_at', { ascending: false });
  if (error) throw error;

  // Group in JS (avoids needing a Postgres aggregate RPC for now)
  const counts = new Map<string, { count: number; last_seen: string }>();
  for (const row of data ?? []) {
    const cur = counts.get(row.event_name);
    if (!cur) {
      counts.set(row.event_name, { count: 1, last_seen: row.received_at });
    } else {
      cur.count++;
    }
  }
  return Array.from(counts.entries()).map(([event_name, { count, last_seen }]) => ({
    event_name,
    count,
    last_seen,
  }));
}

/** Returns the most recent N raw events for a repo. */
export async function getRecentEvents(repoId: number, limit = 50): Promise<DbEvent[]> {
  const { data, error } = await getDb()
    .from('events')
    .select('*')
    .eq('repo_id', repoId)
    .order('received_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as DbEvent[];
}
