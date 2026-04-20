import type { FileContent } from '../types';
import type { RawInteraction } from './types';

const VERB_WORDS = new Set([
  'handle', 'on', 'create', 'delete', 'update', 'add', 'remove', 'save', 'submit',
  'start', 'stop', 'test', 'select', 'toggle', 'enable', 'disable', 'cancel',
  'close', 'open', 'change', 'set', 'get', 'fetch', 'load', 'process', 'send',
  'receive', 'check', 'validate', 'click', 'press', 'tap', 'clear', 'reset',
  'refresh', 'reload', 'upload', 'download', 'edit', 'view', 'show', 'hide',
  'move', 'copy', 'sort', 'filter', 'search', 'init', 'run', 'execute',
]);

/**
 * Detect user interactions in code without naming them.
 *
 * Finds: click handlers, form submits, route handlers, mutations,
 * lifecycle hooks, state changes, toggles.
 *
 * Does NOT: generate event names. That's step 05's job.
 */
export function detectInteractions(files: FileContent[]): RawInteraction[] {
  const interactions: RawInteraction[] = [];

  for (const file of files) {
    if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
    if (file.path.includes('node_modules') || file.path.includes('dist') || file.path.includes('build')) continue;

    const content = file.content;
    const lines = content.split('\n');

    interactions.push(...detectClickHandlers(file, content, lines));
    interactions.push(...detectFormSubmits(file, content, lines));
    interactions.push(...detectHandlerDeclarations(file, content, lines));
    interactions.push(...detectRouteHandlers(file, content, lines));
    interactions.push(...detectMutations(file, content, lines));
    interactions.push(...detectServerActions(file, content, lines));
    interactions.push(...detectTRPCMutationsAndQueries(file, content, lines));
    interactions.push(...detectReduxDispatches(file, content, lines));
    interactions.push(...detectToggles(file, content, lines));
    interactions.push(...detectErrorBoundaries(file, content, lines));
    interactions.push(...detectAPICalls(file, content, lines));
    interactions.push(...detectRetryLogic(file, content, lines));
    interactions.push(...detectJobHandlers(file, content, lines));
  }

  return deduplicateInteractions(interactions);
}

// ─── Per-pattern detectors ───

function detectClickHandlers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /onClick\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const expr = m[1].trim();
    const handlerName = extractHandlerName(expr);
    if (!handlerName) continue;

    const { line, context } = buildContext(content, m.index, lines);
    const isInline = !expr.startsWith('handle') || /=>\s*\w+\s*\(/.test(expr);

    results.push({
      type: 'click_handler',
      file: file.path,
      line,
      functionName: handlerName,
      codeContext: context,
      uiHint: extractUiHint(context),
      relatedEntities: [
        ...extractEntitiesFromName(handlerName),
        ...extractEntitiesFromFilePath(file.path),
      ].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `onClick={${expr}}`,
      confidence: isInline ? 0.7 : 0.85,
    });
  }

  return results;
}

function detectFormSubmits(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /onSubmit\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const expr = m[1].trim();
    const handlerName = extractHandlerName(expr) ?? expr.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
    if (!handlerName) continue;

    const { line, context } = buildContext(content, m.index, lines);

    results.push({
      type: 'form_submit',
      file: file.path,
      line,
      functionName: handlerName,
      codeContext: context,
      uiHint: extractUiHint(context),
      relatedEntities: [
        ...extractEntitiesFromName(handlerName),
        ...extractEntitiesFromFilePath(file.path),
      ].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `onSubmit={${expr}}`,
      confidence: 0.9,
    });
  }

  return results;
}

function detectHandlerDeclarations(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // const handleX = (...) =>
  const arrowPattern = /\bconst\s+(handle[A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  // function handleX(...)
  const funcPattern = /\bfunction\s+(handle[A-Za-z0-9_]+)\s*\(/g;

  for (const pattern of [arrowPattern, funcPattern]) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const handlerName = m[1];
      const { line, context } = buildContext(content, m.index, lines);

      results.push({
        type: 'click_handler',
        file: file.path,
        line,
        functionName: handlerName,
        codeContext: context,
        relatedEntities: [
          ...extractEntitiesFromName(handlerName),
          ...extractEntitiesFromFilePath(file.path),
        ].filter((v, i, arr) => arr.indexOf(v) === i),
        confidence: 0.5,
      });
    }
  }

  return results;
}

function detectRouteHandlers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // Express/Fastify: router.post('/path', ...) or app.get('/path', ...)
  const expressPattern = /(?:router|app)\.(post|get|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  let m: RegExpExecArray | null;
  while ((m = expressPattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const method = m[1].toUpperCase();
    const routePath = m[2];
    const { line, context } = buildContext(content, m.index, lines);
    const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    results.push({
      type: 'route_handler',
      file: file.path,
      line,
      functionName: `${method} ${routePath}`,
      codeContext: context,
      relatedEntities: extractEntitiesFromRoutePath(routePath),
      triggerExpression: `${method.toLowerCase()}('${routePath}')`,
      confidence: isWrite ? 0.9 : 0.4,
    });
  }

  // Next.js App Router: export async function POST/GET/etc in route.ts files
  if (file.path.match(/\/api\/.*\/route\.(ts|js)$/)) {
    const appRouterPattern = /export\s+(?:async\s+)?function\s+(POST|GET|PUT|PATCH|DELETE)\s*\(/g;
    while ((m = appRouterPattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const method = m[1].toUpperCase();
      const routePath = file.path
        .replace(/^src\/app/, '')
        .replace(/\/route\.(ts|js)$/, '')
        .replace(/\\/g, '/');
      const { line, context } = buildContext(content, m.index, lines);
      const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

      results.push({
        type: 'route_handler',
        file: file.path,
        line,
        functionName: `${method} ${routePath}`,
        codeContext: context,
        relatedEntities: extractEntitiesFromRoutePath(routePath),
        triggerExpression: `export function ${method}`,
        confidence: isWrite ? 0.9 : 0.4,
      });
    }
  }

  // Next.js Pages Router: export default function handler in pages/api/**
  if (file.path.match(/pages\/api\/.+\.(ts|js)$/)) {
    const pageHandlerPattern = /export\s+default\s+(?:async\s+)?function\s+(?:handler\s*)?\(/g;
    while ((m = pageHandlerPattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const routePath = '/api/' + file.path
        .replace(/^.*pages\/api\//, '')
        .replace(/\.(ts|js)$/, '')
        .replace(/\\/g, '/');
      const { line, context } = buildContext(content, m.index, lines);

      results.push({
        type: 'route_handler',
        file: file.path,
        line,
        functionName: `HANDLER ${routePath}`,
        codeContext: context,
        relatedEntities: extractEntitiesFromRoutePath(routePath),
        triggerExpression: 'export default function handler',
        confidence: 0.7,
      });
    }
  }

  return results;
}

function detectMutations(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  let m: RegExpExecArray | null;

  // Prisma: prisma.model.create/update/delete/upsert(
  const prismaPattern = /prisma\.([a-zA-Z][a-zA-Z0-9]*)\.(create|update|delete|upsert|deleteMany|updateMany|createMany)\s*\(/g;
  while ((m = prismaPattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const model = m[1];
    const op = m[2];
    const { line, context } = buildContext(content, m.index, lines);

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName: `prisma.${model}.${op}`,
      codeContext: context,
      relatedEntities: [model.toLowerCase()],
      triggerExpression: `prisma.${model}.${op}(`,
      confidence: 0.85,
    });
  }

  // Supabase: supabase.from('table').insert/update/delete(
  const supabasePattern = /supabase\.from\(['"]([^'"]+)['"]\)\.(insert|update|delete|upsert)\s*\(/g;
  while ((m = supabasePattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const table = m[1];
    const op = m[2];
    const { line, context } = buildContext(content, m.index, lines);

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName: `supabase.from('${table}').${op}`,
      codeContext: context,
      relatedEntities: [table.replace(/s$/, '').toLowerCase()],
      triggerExpression: `supabase.from('${table}').${op}(`,
      confidence: 0.85,
    });
  }

  // Drizzle: db.insert(table).values / db.update(table).set / db.delete(table)
  const drizzlePattern = /db\.(insert|update|delete)\s*\(\s*([a-zA-Z][a-zA-Z0-9]*)\s*\)/g;
  while ((m = drizzlePattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const op = m[1];
    const table = m[2];
    const { line, context } = buildContext(content, m.index, lines);

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName: `db.${op}(${table})`,
      codeContext: context,
      relatedEntities: [table.replace(/s$/, '').toLowerCase()],
      triggerExpression: `db.${op}(${table})`,
      confidence: 0.85,
    });
  }

  // useMutation (React Query / tRPC)
  const useMutationPattern = /\buseMutation\s*[(<]/g;
  while ((m = useMutationPattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const { line, context } = buildContext(content, m.index, lines);
    const entities = extractEntitiesFromFilePath(file.path);

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName: 'useMutation',
      codeContext: context,
      relatedEntities: entities,
      triggerExpression: 'useMutation(',
      confidence: 0.75,
    });
  }

  return results;
}

function detectToggles(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /onCheckedChange\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const expr = m[1].trim();
    const handlerName = extractHandlerName(expr) ?? expr.slice(0, 40);
    const { line, context } = buildContext(content, m.index, lines);

    results.push({
      type: 'toggle',
      file: file.path,
      line,
      functionName: handlerName,
      codeContext: context,
      uiHint: extractUiHint(context),
      relatedEntities: [
        ...extractEntitiesFromName(handlerName),
        ...extractEntitiesFromFilePath(file.path),
      ].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `onCheckedChange={${expr}}`,
      confidence: 0.6,
    });
  }

  return results;
}

function detectServerActions(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  if (!/(['\"])use server\1/.test(content)) return [];

  const results: RawInteraction[] = [];
  const pattern = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const fn = m[1];
    const { line, context } = buildContext(content, m.index, lines);
    results.push({
      type: 'lifecycle',
      file: file.path,
      line,
      functionName: fn,
      codeContext: context,
      relatedEntities: [...extractEntitiesFromName(fn), ...extractEntitiesFromFilePath(file.path)].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `serverAction(${fn})`,
      confidence: 0.6,
    });
  }
  return results;
}

function detectTRPCMutationsAndQueries(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // Server-side: { workflow: publicProcedure.mutation(...)} or { workflow: ...query(...)}
  const keyProcPattern = /([A-Za-z0-9_]+)\s*:\s*[^;]*?\.(mutation|query)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = keyProcPattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const key = m[1];
    const op = m[2].toLowerCase();
    const { line, context } = buildContext(content, m.index, lines);

    const verb = guessLikelyVerbFromContext(context, op === 'mutation' ? 'mutation' : 'query');
    const objectPascal = toPascalCase(key.replace(/[-_]/g, ' '));
    const functionName = `${toPascalCase(verb)}${objectPascal}`;

    results.push({
      type: op === 'mutation' ? 'lifecycle' : 'state_change',
      file: file.path,
      line,
      functionName,
      codeContext: context,
      relatedEntities: [...extractEntitiesFromName(functionName), ...extractEntitiesFromFilePath(file.path)].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `${op}(${key})`,
      confidence: op === 'mutation' ? 0.65 : 0.45,
    });
  }

  // Client-side hooks: something.useMutation(...)
  const hookPattern = /\.use(Mutation|Query)\s*(?:<[^>]+>)?\s*\(/g;
  while ((m = hookPattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const { line, context } = buildContext(content, m.index, lines);
    const op = String(m[1] ?? '').toLowerCase();
    const verb = op === 'query' ? 'select' : 'create';
    const objectFromPath = extractEntitiesFromFilePath(file.path)[0] ?? 'item';
    const objectPascal = toPascalCase(objectFromPath.replace(/[-_]/g, ' '));
    const functionName = `${toPascalCase(verb)}${objectPascal}`;

    results.push({
      type: 'lifecycle',
      file: file.path,
      line,
      functionName,
      codeContext: context,
      relatedEntities: [...extractEntitiesFromName(functionName)].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `trpc.${op}()`,
      confidence: op === 'query' ? 0.4 : 0.6,
    });
  }

  return results;
}

function detectReduxDispatches(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // dispatch(createWorkflow(...))
  const pattern = /\bdispatch\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const actionCreator = m[1];
    const { line, context } = buildContext(content, m.index, lines);
    results.push({
      type: 'state_change',
      file: file.path,
      line,
      functionName: actionCreator,
      codeContext: context,
      relatedEntities: [...extractEntitiesFromName(actionCreator), ...extractEntitiesFromFilePath(file.path)].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `dispatch(${actionCreator}(`,
      confidence: 0.55,
    });
  }

  return results;
}

function guessLikelyVerbFromContext(context: string, mode: 'mutation' | 'query'): string {
  const lower = context.toLowerCase();
  const order: Array<[RegExp, string]> = [
    [/delete|remove/, 'delete'],
    [/update|edit/, 'update'],
    [/create|add|insert|new|save/, 'create'],
    [/toggle|enable/, 'toggle'],
    [/disable/, 'disable'],
    [/select|fetch|load|get/, 'select'],
  ];
  for (const [rx, verb] of order) {
    if (rx.test(lower)) return verb;
  }
  return mode === 'query' ? 'select' : 'create';
}

function toPascalCase(s: string): string {
  return s
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

// ─── Operational pattern detectors ───

function detectErrorBoundaries(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  // try/catch blocks
  const tryCatch = /\btry\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = tryCatch.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const { line, context } = buildContext(content, m.index, lines);
    const funcName = findEnclosingFunction(lines, line) ?? 'errorHandler';
    const entities = extractEntitiesFromContext(context);
    results.push({
      type: 'error_boundary',
      file: file.path,
      line,
      functionName: funcName,
      codeContext: context,
      relatedEntities: entities,
      confidence: 0.7,
    });
  }
  // .catch() chains
  const dotCatch = /\.catch\s*\(/g;
  while ((m = dotCatch.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const { line, context } = buildContext(content, m.index, lines);
    const funcName = findEnclosingFunction(lines, line) ?? 'catchHandler';
    const entities = extractEntitiesFromContext(context);
    results.push({
      type: 'error_boundary',
      file: file.path,
      line,
      functionName: funcName,
      codeContext: context,
      relatedEntities: entities,
      confidence: 0.65,
    });
  }
  return results;
}

function detectAPICalls(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const patterns: RegExp[] = [
    /\bfetch\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\baxios\s*\.\s*(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\b\w+Client\s*\.\s*request\s*\(/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const { line, context } = buildContext(content, m.index, lines);
      const url = m[1] ?? '';
      const entities = url ? extractEntitiesFromURL(url) : extractEntitiesFromContext(context);
      const funcName = findEnclosingFunction(lines, line) ?? 'apiCall';
      results.push({
        type: 'api_call',
        file: file.path,
        line,
        functionName: funcName,
        codeContext: context,
        relatedEntities: entities,
        triggerExpression: m[0].slice(0, 60),
        confidence: 0.6,
      });
    }
  }
  return results;
}

function detectRetryLogic(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const patterns: RegExp[] = [
    /\bwithRetry\s*\(/g,
    /\bretry\s*\(/g,
    /\bbackoff\s*\(/g,
    /(?:for|while)\s*\([^)]*(?:retry|attempt|retries)[^)]*\)/g,
  ];
  const seen = new Set<number>();
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const { line, context } = buildContext(content, m.index, lines);
      if (seen.has(line)) continue;
      seen.add(line);
      const funcName = findEnclosingFunction(lines, line) ?? 'retryHandler';
      results.push({
        type: 'retry_logic',
        file: file.path,
        line,
        functionName: funcName,
        codeContext: context,
        relatedEntities: extractEntitiesFromContext(context),
        triggerExpression: m[0].slice(0, 60),
        confidence: 0.75,
      });
    }
  }
  return results;
}

function detectJobHandlers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const patterns: RegExp[] = [
    /\bqueue\s*\.\s*process\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /\bcron\s*\.\s*schedule\s*\(/g,
    /\bcreateFunction\s*\(\s*\{[^}]*name\s*:/g,
    /\binngest\.createFunction\s*\(/g,
    /\bbullmq\s*\.\s*(?:add|process)\s*\(/g,
  ];
  for (const pattern of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(content)) !== null) {
      if (isInsideStringOrComment(content, m.index)) continue;
      const { line, context } = buildContext(content, m.index, lines);
      const jobName = m[1] ?? findEnclosingFunction(lines, line) ?? 'jobHandler';
      results.push({
        type: 'job_handler',
        file: file.path,
        line,
        functionName: jobName,
        codeContext: context,
        relatedEntities: extractEntitiesFromContext(context),
        triggerExpression: m[0].slice(0, 60),
        confidence: 0.85,
      });
    }
  }
  return results;
}

// ─── Operational helper functions ───

function findEnclosingFunction(lines: string[], lineNumber: number): string | null {
  const BUILTIN = new Set(['Promise', 'Error', 'Object', 'Array', 'Function', 'if', 'for', 'while', 'switch']);
  const funcPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:const|let|var)\s+(\w+)\s*=\s*async\s+\()/;
  // Walk backward from the interaction line
  for (let i = Math.min(lineNumber - 1, lines.length - 1); i >= 0; i--) {
    const line = lines[i];
    const m = line.match(funcPattern);
    if (m) {
      const name = m[1] ?? m[2] ?? m[3];
      if (name && !BUILTIN.has(name)) return name;
    }
  }
  return null;
}

function extractEntitiesFromContext(context: string): string[] {
  const BUILTIN = new Set(['Promise', 'Error', 'Object', 'Array', 'Function', 'Request', 'Response', 'Event', 'String', 'Number', 'Boolean']);
  const matches = context.match(/\b[A-Z][a-z]{2,}[A-Za-z]*\b/g) ?? [];
  return [...new Set(matches)].filter((w) => !BUILTIN.has(w)).slice(0, 5);
}

function extractEntitiesFromURL(url: string): string[] {
  const cleanUrl = url.split('?')[0]; // strip query string
  return cleanUrl
    .split('/')
    .filter((p) => p && !p.startsWith(':') && !p.startsWith('{') && !p.includes('$'))
    .filter((p) => !/^https?:$/.test(p))
    .filter((p) => !p.includes('.'))
    .filter((p) => !['api', 'v1', 'v2', 'v3'].includes(p))
    .flatMap((p) => p.replace(/-/g, '_').split('_'))
    .map((p) => p.replace(/s$/, ''))
    .filter((p) => p.length >= 3 && !/^\d+$/.test(p) && /^[a-z0-9]+$/i.test(p))
    .slice(0, 3);
}

// ─── Deduplication ───

function deduplicateInteractions(interactions: RawInteraction[]): RawInteraction[] {
  // Operational types (multiple per function are valid) deduplicate by file + line.
  // User-interaction types deduplicate by file + functionName (one event per handler).
  const OPERATIONAL = new Set<RawInteraction['type']>(['error_boundary', 'api_call', 'retry_logic', 'job_handler']);
  const byKey = new Map<string, RawInteraction>();

  for (const interaction of interactions) {
    const key = OPERATIONAL.has(interaction.type)
      ? `${interaction.file}::${interaction.type}::${interaction.line}`
      : `${interaction.file}::${interaction.functionName}`;
    const existing = byKey.get(key);
    if (!existing || interaction.confidence > existing.confidence) {
      byKey.set(key, interaction);
    }
  }

  return Array.from(byKey.values());
}

// ─── Helpers ───

/**
 * Returns true if the character at matchIndex in content is inside a string literal,
 * single-line comment, or block comment. Used to suppress false positives from
 * regex detectors matching documentation strings, template literals, or commented code.
 */
function isInsideStringOrComment(content: string, matchIndex: number): boolean {
  const before = content.substring(0, matchIndex);

  // Fast path: check if this line starts with a comment marker
  const lastNl = before.lastIndexOf('\n');
  const lineStart = before.substring(lastNl + 1);
  if (/^\s*(\/\/|\*)/.test(lineStart)) return true;

  // Check for inline // comment before the match on this line
  const inlineCommentIdx = lineStart.indexOf('//');
  if (inlineCommentIdx !== -1) {
    const beforeComment = lineStart.substring(0, inlineCommentIdx);
    const singleCount = (beforeComment.match(/'/g) ?? []).length;
    const doubleCount = (beforeComment.match(/"/g) ?? []).length;
    // If quotes are balanced, the // is outside any string → it's a real comment
    if (singleCount % 2 === 0 && doubleCount % 2 === 0) return true;
  }

  // Check for unclosed block comment /* ... */
  const lastOpen = before.lastIndexOf('/*');
  if (lastOpen !== -1) {
    const lastClose = before.lastIndexOf('*/');
    if (lastClose < lastOpen) return true;
  }

  // Walk the content up to matchIndex tracking string state
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) {
      i++; // skip escaped character
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === '`') inTemplate = true;
    } else if (inSingle && ch === "'") {
      inSingle = false;
    } else if (inDouble && ch === '"') {
      inDouble = false;
    } else if (inTemplate && ch === '`') {
      inTemplate = false;
    }
  }

  return inSingle || inDouble || inTemplate;
}

function buildContext(
  content: string,
  index: number,
  lines: string[]
): { line: number; context: string } {
  const line = content.substring(0, index).split('\n').length; // 1-indexed
  const start = Math.max(0, line - 5);
  const end = Math.min(lines.length, line + 15);
  return { line, context: lines.slice(start, end).join('\n') };
}

function extractHandlerName(expr: string): string | null {
  // Direct: handleFoo
  if (/^handle[A-Za-z0-9_]+$/.test(expr)) return expr;
  // Inline: () => handleFoo(...) or (e) => handleFoo(e)
  const arrowMatch = expr.match(/handle[A-Za-z0-9_]+/);
  return arrowMatch?.[0] ?? null;
}

function extractUiHint(context: string): string | undefined {
  // aria-label="..."
  const ariaMatch = context.match(/aria-label=['"]([^'"]{2,60})['"]/);
  if (ariaMatch) return ariaMatch[1];

  // title="..."
  const titleMatch = context.match(/title=['"]([^'"]{2,60})['"]/);
  if (titleMatch) return titleMatch[1];

  // Nearby button/link text (simple text child)
  const btnText = context.match(/<[Bb]utton[^>]*>\s*([A-Za-z][^<\n]{2,40}?)\s*</);
  if (btnText) return btnText[1].trim();

  return undefined;
}

function extractEntitiesFromName(name: string): string[] {
  // Strip common prefixes
  const stripped = name.replace(/^(handle|on)/i, '');
  if (!stripped) return [];

  // Split camelCase: "CreateWorkflow" → ["Create", "Workflow"]
  const parts = stripped.split(/(?=[A-Z])/).filter((p) => p.length > 0);

  return parts
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= 3 && !VERB_WORDS.has(p));
}

function extractEntitiesFromFilePath(filePath: string): string[] {
  const base = filePath.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/\.(ts|tsx|js|jsx)$/, '')
    .replace(/Panel$|Modal$|Form$|Dialog$|Page$|Component$|Container$|View$/i, '');

  if (!cleaned) return [];

  const NON_ENTITIES = new Set(['index', 'route', 'page', 'app', 'root', 'main', 'layout']);

  return cleaned
    .split(/(?=[A-Z])/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length >= 3 && !NON_ENTITIES.has(p) && !VERB_WORDS.has(p));
}

function extractEntitiesFromRoutePath(routePath: string): string[] {
  // "/api/workflows/:id/steps" → ["workflow", "step"]
  return routePath
    .split('/')
    .filter((p) => p && !p.startsWith(':') && !['api', 'v1', 'v2', 'v3'].includes(p))
    .flatMap((p) => p.replace(/-/g, '_').split('_'))
    .map((p) => p.replace(/s$/, '')) // plurals → singular
    .filter((p) => p.length >= 3);
}
