import type {
  Actor,
  TrackedObject,
  ObjectToObjectRelationship,
  ObjectLifecycle,
  TrackingPlanContext,
  FileContent,
  JoinPath,
} from '../types';

export function extractTrackingPlanContext(files: FileContent[]): TrackingPlanContext {
  const actors = extractActors(files);
  const objects = extractObjects(files);
  const relationships: ObjectToObjectRelationship[] = extractRelationships(files, objects);
  const lifecycles = extractLifecycles(files, objects);
  const joinPaths = buildJoinPaths(relationships);
  return { actors, objects, relationships, lifecycles, joinPaths };
}

function extractActors(files: FileContent[]): Actor[] {
  let hasUser = false;
  let hasSystem = false;
  let hasStripe = false;

  for (const f of files) {
    const c = f.content;
    if (/req\.user\b|request\.user\b|session\.user\b/.test(c) || /\buse(Auth|User|Session)\b/.test(c)) {
      hasUser = true;
    }
    if (/\bcron\b|\bschedule\b|\bsetInterval\b/.test(c)) hasSystem = true;
    if (/\bstripe\b/i.test(c) && /\bwebhook\b/i.test(c)) hasStripe = true;
  }

  const actors: Actor[] = [];
  if (hasUser) {
    actors.push({
      name: 'User',
      type: 'user',
      source: 'inferred',
      identifierPattern: 'user.id',
      canPerformActions: [],
      detectedFrom: 'auth/session usage',
      confidence: 0.7,
    });
  }
  if (hasSystem) {
    actors.push({
      name: 'System',
      type: 'system',
      source: 'inferred',
      identifierPattern: 'system',
      canPerformActions: [],
      detectedFrom: 'cron/scheduler patterns',
      confidence: 0.5,
    });
  }
  if (hasStripe) {
    actors.push({
      name: 'Stripe',
      type: 'integration',
      source: 'inferred',
      identifierPattern: 'stripe.customer',
      canPerformActions: [],
      detectedFrom: 'stripe webhook patterns',
      confidence: 0.6,
    });
  }

  return actors;
}

function extractObjects(files: FileContent[]): TrackedObject[] {
  const byName = new Map<string, TrackedObject>();

  const add = (name: string, source: TrackedObject['source'], exposedViaAPI: boolean, properties?: string[]) => {
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.exposedViaAPI = existing.exposedViaAPI || exposedViaAPI;
      if (properties?.length) {
        const merged = new Set([...(existing.properties ?? []), ...properties]);
        existing.properties = Array.from(merged);
      }
      return;
    }
    byName.set(key, {
      name,
      source,
      properties: properties ?? [],
      belongsTo: [],
      exposedViaAPI,
      confidence: 0.6,
      needsReview: true,
    });
  };

  for (const f of files) {
    const c = f.content;

    // Prisma-like: prisma.workflow.create(...)
    for (const m of c.matchAll(/\bprisma\.([A-Za-z_][A-Za-z0-9_]*)\.(create|update|delete|upsert)\b/g)) {
      const model = m[1];
      add(toPascalCase(model), 'prisma', false, ['id']);
    }

    // Supabase: supabase.from('workflows')
    for (const m of c.matchAll(/\bsupabase\.from\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const table = m[1];
      const singular = table.replace(/s$/, '');
      add(toPascalCase(singular), 'database', false, ['id']);
    }

    // API routes: '/api/workflows' or /api/workflows
    for (const m of c.matchAll(/['"`]\/api\/([A-Za-z0-9_-]+)(?:\/|['"`])/g)) {
      const seg = m[1];
      const singular = seg.replace(/s$/, '').replace(/-/g, '_');
      add(toPascalCase(singular), 'inferred', true, ['id']);
    }
  }

  return Array.from(byName.values());
}

function extractRelationships(files: FileContent[], objects: TrackedObject[]): ObjectToObjectRelationship[] {
  const objectSet = new Set(objects.map((o) => o.name.toLowerCase()));
  const rels: ObjectToObjectRelationship[] = [];

  const add = (child: string, parent: string, relationship: string, why: string) => {
    if (!child || !parent) return;
    rels.push({
      child,
      parent,
      relationship,
      contextImplication: why,
    });
  };

  for (const f of files) {
    const c = f.content;
    const childGuess = guessPrimaryObjectFromFile(f.path, c, objects);

    // Look for foreign-key-ish fields: workflowId, userId, organizationId, step_id, etc.
    for (const m of c.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*?)(Id|_id)\b/g)) {
      const base = m[1];
      const parent = toPascalCase(base.replace(/_+$/g, ''));
      if (!objectSet.has(parent.toLowerCase())) continue;
      const child = childGuess ?? 'Unknown';
      add(child, parent, 'belongs_to', `Detected foreign-key field ${m[0]} in ${f.path}`);
    }
  }

  // De-dup + also backfill TrackedObject.belongsTo
  const keySet = new Set<string>();
  const out: ObjectToObjectRelationship[] = [];
  for (const r of rels) {
    if (r.child === 'Unknown') continue;
    const key = `${r.child.toLowerCase()}::${r.parent.toLowerCase()}::${r.relationship}`;
    if (keySet.has(key)) continue;
    keySet.add(key);
    out.push(r);
  }

  const byName = new Map(objects.map((o) => [o.name.toLowerCase(), o]));
  for (const r of out) {
    const child = byName.get(r.child.toLowerCase());
    if (!child) continue;
    if (!child.belongsTo.includes(r.parent)) child.belongsTo.push(r.parent);
  }

  return out;
}

function buildJoinPaths(relationships: ObjectToObjectRelationship[]): JoinPath[] {
  // Build directed edges child -> parent
  const edges = new Map<string, Array<{ to: string; via: string }>>();
  for (const r of relationships) {
    const from = r.child;
    const to = r.parent;
    const via = `${from}.${toSnake(r.parent)}_id → ${to}.id`;
    const list = edges.get(from) ?? [];
    list.push({ to, via });
    edges.set(from, list);
  }

  const joinPaths: JoinPath[] = [];
  const objects = Array.from(new Set([...edges.keys(), ...Array.from(edges.values()).flatMap((v) => v.map((x) => x.to))]));

  // Compute paths up to length 3
  for (const start of objects) {
    const queue: Array<{ node: string; via: string[] }> = [{ node: start, via: [] }];
    const seen = new Set<string>([start]);

    while (queue.length) {
      const cur = queue.shift()!;
      const nexts = edges.get(cur.node) ?? [];
      for (const n of nexts) {
        const nextVia = [...cur.via, n.via];
        const key = `${start}::${n.to}::${nextVia.join('|')}`;
        joinPaths.push({ from: start, to: n.to, via: nextVia });
        if (nextVia.length >= 3) continue;
        const visitKey = `${cur.node}->${n.to}`;
        if (seen.has(visitKey)) continue;
        seen.add(visitKey);
        queue.push({ node: n.to, via: nextVia });
      }
    }
  }

  // De-dup by from/to; keep shortest
  const best = new Map<string, JoinPath>();
  for (const jp of joinPaths) {
    const key = `${jp.from}::${jp.to}`;
    const existing = best.get(key);
    if (!existing || jp.via.length < existing.via.length) best.set(key, jp);
  }
  return Array.from(best.values());
}

function guessPrimaryObjectFromFile(pathName: string, content: string, objects: TrackedObject[]): string | null {
  // 1) Prisma model in file
  const prisma = content.match(/\bprisma\.([A-Za-z_][A-Za-z0-9_]*)\./);
  if (prisma) return toPascalCase(prisma[1]);

  // 2) Supabase table
  const supabase = content.match(/\bsupabase\.from\(\s*['"]([^'"]+)['"]\s*\)/);
  if (supabase) return toPascalCase(supabase[1].replace(/s$/, ''));

  // 3) API route segment in file
  const api = content.match(/['"`]\/api\/([A-Za-z0-9_-]+)/);
  if (api) return toPascalCase(api[1].replace(/s$/, '').replace(/-/g, '_'));

  // 4) filename heuristic
  const base = pathName.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/\.(ts|tsx|js|jsx)$/, '');
  const guess = toPascalCase(cleaned.replace(/s$/, ''));
  if (objects.some((o) => o.name.toLowerCase() === guess.toLowerCase())) return guess;
  return null;
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function extractLifecycles(files: FileContent[], objects: TrackedObject[]): ObjectLifecycle[] {
  const out: ObjectLifecycle[] = [];
  const objectNames = new Set(objects.map((o) => o.name.toLowerCase()));

  // enum WorkflowStatus { DRAFT, ACTIVE }
  for (const f of files) {
    const c = f.content;
    for (const m of c.matchAll(/\benum\s+([A-Za-z_][A-Za-z0-9_]*Status)\s*\{([\s\S]*?)\}/g)) {
      const enumName = m[1];
      const body = m[2] ?? '';
      const states = body
        .split(/[,\\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/=.*/, '').trim())
        .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))
        .map((s) => s.toLowerCase());

      const object = enumName.replace(/Status$/, '');
      const objectKey = object.toLowerCase();
      if (!objectNames.has(objectKey)) continue;
      if (states.length === 0) continue;
      out.push({
        object,
        states: Array.from(new Set(states)),
        transitions: [],
      });
    }

    // type Status = 'draft' | 'active'
    for (const m of c.matchAll(/\btype\s+([A-Za-z_][A-Za-z0-9_]*Status)\s*=\s*([^;]+);/g)) {
      const typeName = m[1];
      const rhs = m[2] ?? '';
      const states = rhs
        .split('|')
        .map((s) => s.trim())
        .map((s) => s.replace(/^['"]|['"]$/g, ''))
        .filter((s) => /^[a-z0-9_-]{3,30}$/i.test(s))
        .map((s) => s.toLowerCase());

      const object = typeName.replace(/Status$/, '');
      const objectKey = object.toLowerCase();
      if (!objectNames.has(objectKey)) continue;
      if (states.length === 0) continue;
      out.push({
        object,
        states: Array.from(new Set(states)),
        transitions: [],
      });
    }
  }

  // De-dup by object
  const byObject = new Map<string, ObjectLifecycle>();
  for (const lc of out) {
    const key = lc.object.toLowerCase();
    const existing = byObject.get(key);
    if (!existing) {
      byObject.set(key, lc);
    } else {
      const merged = new Set([...(existing.states ?? []), ...(lc.states ?? [])]);
      existing.states = Array.from(merged);
    }
  }

  return Array.from(byObject.values());
}

function toPascalCase(s: string): string {
  return s
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

