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
 * Five framework-agnostic shape-based detectors:
 *   1. detectUITriggers        — onClick / onSubmit / onCheckedChange in JSX
 *   2. detectHandlerDeclarations — const handleX / function handleX / const useCreateX
 *   3. detectRouteHandlers     — Express-style and Next.js route handlers
 *   4. detectGenericCRUD       — any .create/.insert/.update/.delete/… call
 *   5. detectMutationHooks     — useMutation with body introspection
 *
 * Does NOT generate event names — that is step 05's job.
 */
export function detectInteractions(files: FileContent[]): RawInteraction[] {
  const interactions: RawInteraction[] = [];

  for (const file of files) {
    if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
    if (file.path.includes('node_modules') || file.path.includes('dist') || file.path.includes('build')) continue;

    const content = file.content;
    const lines = content.split('\n');

    interactions.push(...detectUITriggers(file, content, lines));
    interactions.push(...detectHandlerDeclarations(file, content, lines));
    interactions.push(...detectRouteHandlers(file, content, lines));
    interactions.push(...detectGenericCRUD(file, content, lines));
    interactions.push(...detectMutationHooks(file, content, lines));
  }

  return deduplicateInteractions(interactions);
}

// ─── 1. UI Triggers ──────────────────────────────────────────────────────────

/**
 * Finds onClick, onSubmit, onCheckedChange handlers in JSX.
 * Works with React, Preact, Solid, or any JSX-like syntax.
 */
function detectUITriggers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const typeMap: Record<string, RawInteraction['type']> = {
    Click: 'click_handler',
    Submit: 'form_submit',
    CheckedChange: 'toggle',
  };
  const pattern = /on(Click|Submit|CheckedChange)\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const eventKind = m[1];
    const expr = m[2].trim();
    const handlerName = extractHandlerName(expr);
    if (!handlerName) continue;

    const type = typeMap[eventKind] ?? 'click_handler';
    const { line, context } = buildContext(content, m.index, lines);
    const isInline = type === 'click_handler' && (!expr.startsWith('handle') || /=>\s*\w+\s*\(/.test(expr));

    results.push({
      type,
      file: file.path,
      line,
      functionName: handlerName,
      codeContext: context,
      uiHint: extractUiHint(context),
      relatedEntities: [
        ...extractEntitiesFromName(handlerName),
        ...extractEntitiesFromFilePath(file.path),
      ].filter((v, i, arr) => arr.indexOf(v) === i),
      triggerExpression: `on${eventKind}={${expr}}`,
      confidence: isInline ? 0.7 : type === 'form_submit' ? 0.9 : 0.85,
    });
  }

  return results;
}

// ─── 2. Handler Declarations ─────────────────────────────────────────────────

/**
 * Finds `const handleX = (…) =>` / `function handleX(…)` declarations, plus
 * `const useCreateX = (…) =>` style React Query mutation hooks.
 */
function detectHandlerDeclarations(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // const handleX = (...) => or const useCreateX = (...) => (React Query hooks)
  const arrowPattern = /\bconst\s+((?:handle|use[A-Z])[A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
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

// ─── 3. Route Handlers ───────────────────────────────────────────────────────

/**
 * Finds HTTP route handlers: Express/Fastify/Hono style and Next.js App/Pages Router.
 */
function detectRouteHandlers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];

  // Express/Fastify/Hono: (router|app).(post|get|…)('/path', …)
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

  // Next.js App Router: export (async) function POST/GET/… in /api/*/route.(ts|js)
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

// ─── CRUD helpers ─────────────────────────────────────────────────────────────

/** ORM/DB client variable names that are not entity names */
const CRUD_CLIENT_PREFIXES = new Set([
  'db', 'sql', 'client', 'pool', 'conn', 'connection', 'knex', 'prisma', 'supabase',
  'mongo', 'mongoose', 'collection', 'this', 'self', 'that', 'repository', 'repo',
  'orm', 'sequelize', 'typeorm', 'kysely', 'drizzle', 'firestore', 'dynamo',
]);

/** Common argument / variable names that are not entity names */
const CRUD_NON_ENTITY_ARGS = new Set([
  'data', 'values', 'where', 'options', 'config', 'req', 'res', 'input', 'body',
  'payload', 'params', 'args', 'ctx', 'context', 'event', 'request', 'response',
  'err', 'error', 'result', 'item', 'obj', 'object',
]);

/**
 * JS built-in / DOM / browser globals whose CRUD calls are false positives.
 * detectGenericCRUD skips any match whose resolved entity is in this set.
 */
const CRUD_SKIP_OBJECTS = new Set([
  'map', 'set', 'array', 'object', 'document', 'window', 'console',
  'element', 'node', 'classlist', 'urlsearchparams', 'headers',
  'formdata', 'searchparams', 'cache', 'store', 'state', 'ref',
  'event', 'error', 'promise', 'json', 'math', 'date', 'regexp',
  'localstorage', 'sessionstorage', 'history', 'location', 'navigator',
]);

/**
 * Resolve entity name from the context surrounding a CRUD method call.
 *
 * Priority:
 *   1. .from('tableName') in backward window — Supabase / Knex (multi-line safe)
 *   2. Last dot-chain identifier before CRUD dot — prisma.user.create → 'user'
 *   3. String literal argument — collection.insert('tableName')
 *   4. Bare identifier argument — db.insert(users)
 */
function resolveEntityFromCRUDContext(backward: string, afterParen: string): string | null {
  // 1) .from('tableName') anywhere in backward
  const fromMatch = backward.match(/\.from\s*\(\s*['"]([^'"]{1,50})['"]\s*\)/);
  if (fromMatch) {
    return fromMatch[1].toLowerCase().replace(/s$/, '') || null;
  }

  // 2) Last dot-separated identifier before the CRUD dot (e.g. prisma.user → 'user')
  const chainMatch = backward.match(/\.([a-zA-Z][a-zA-Z0-9]{1,})$/);
  if (chainMatch) {
    const candidate = chainMatch[1].toLowerCase();
    if (!CRUD_CLIENT_PREFIXES.has(candidate) && candidate.length >= 3) {
      return candidate.replace(/s$/, '');
    }
  }

  // 3) String argument directly after paren
  const strArgMatch = afterParen.match(/^['"]([^'"]{1,50})['"]/);
  if (strArgMatch) {
    return strArgMatch[1].toLowerCase().replace(/s$/, '');
  }

  // 4) Bare identifier argument — db.insert(users) or collection('items')
  const idArgMatch = afterParen.match(/^([a-zA-Z][a-zA-Z0-9_]{2,})\s*[,)]/);
  if (idArgMatch) {
    const candidate = idArgMatch[1];
    if (!CRUD_NON_ENTITY_ARGS.has(candidate.toLowerCase()) &&
        !CRUD_CLIENT_PREFIXES.has(candidate.toLowerCase())) {
      return candidate.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/s$/, '');
    }
  }

  return null;
}

/**
 * Scan a code body snippet for the first CRUD call and return entity + op.
 * Used to extract entity info from useMutation bodies.
 */
function findCRUDInBody(body: string): { entity: string; op: string } | null {
  const pattern = /\.(create|insert|update|delete|upsert|remove|destroy|save)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    if (isInsideStringOrComment(body, m.index)) continue;
    const op = m[1];
    const matchEnd = m.index + m[0].length;
    const backward = body.substring(Math.max(0, m.index - 200), m.index);
    const afterParen = body.substring(matchEnd, matchEnd + 80);
    const entity = resolveEntityFromCRUDContext(backward, afterParen);
    if (entity && !CRUD_SKIP_OBJECTS.has(entity.toLowerCase())) return { entity, op };
  }
  return null;
}

// ─── 4. Generic CRUD ─────────────────────────────────────────────────────────

/**
 * Finds any .create/.insert/.update/.delete/.upsert/.remove/.destroy/.save(
 * call regardless of ORM or framework. Resolves entity by scanning backward
 * up to 300 chars (handles multi-line chains). Skips DOM/built-in false positives
 * via CRUD_SKIP_OBJECTS.
 *
 * Confidence tiers:
 *   0.85 — entity from .from() or model chain (direct context)
 *   0.7  — entity from enclosing function name (heuristic)
 *   0.6  — entity from file path (last resort)
 */
function detectGenericCRUD(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /\.(create|insert|update|delete|upsert|remove|destroy|save)\s*\(/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;

    const op = m[1];
    const matchEnd = m.index + m[0].length;
    const backward = content.substring(Math.max(0, m.index - 300), m.index);
    const afterParen = content.substring(matchEnd, matchEnd + 80);
    const { line, context } = buildContext(content, m.index, lines);

    let entity = resolveEntityFromCRUDContext(backward, afterParen);
    let confidence = 0.85;

    if (!entity) {
      const funcName = findEnclosingFunction(lines, line);
      if (funcName) entity = extractEntitiesFromName(funcName)[0] ?? null;
      if (entity) confidence = 0.7;
    }
    if (!entity) {
      entity = extractEntitiesFromFilePath(file.path)[0] ?? null;
      if (entity) confidence = 0.6;
    }

    if (!entity || CRUD_SKIP_OBJECTS.has(entity.toLowerCase())) continue;

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName: `${entity}.${op}`,
      codeContext: context,
      relatedEntities: [entity],
      triggerExpression: `.${op}(`,
      confidence,
    });
  }

  return results;
}

// ─── 5. Mutation Hooks ────────────────────────────────────────────────────────

/**
 * Finds useMutation hooks (React Query, SWR, tRPC client) and extracts entity
 * info from the mutationFn body. Uses the enclosing hook name (e.g. useDeleteIssue)
 * so the naming layer can strip the "use" prefix to produce a useful event name.
 */
function detectMutationHooks(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /\buseMutation\s*[(<]/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
    if (isInsideStringOrComment(content, m.index)) continue;
    const { line, context } = buildContext(content, m.index, lines);

    // Scan the mutationFn body for CRUD calls
    const ahead = content.substring(m.index, m.index + 1000);
    const mutFnMatch = ahead.match(/mutationFn\s*:/);
    let crudInfo: { entity: string; op: string } | null = null;
    if (mutFnMatch) {
      const bodyStart = m.index + mutFnMatch.index! + mutFnMatch[0].length;
      crudInfo = findCRUDInBody(content.substring(bodyStart, bodyStart + 500));
    }

    // Prefer the enclosing hook name (useDeleteIssue) over the generic 'useMutation'
    const enclosing = findEnclosingFunction(lines, line);
    const functionName = (enclosing && enclosing !== 'useMutation') ? enclosing : 'useMutation';

    results.push({
      type: 'mutation',
      file: file.path,
      line,
      functionName,
      codeContext: context,
      relatedEntities: crudInfo ? [crudInfo.entity] : extractEntitiesFromFilePath(file.path),
      triggerExpression: 'useMutation(',
      confidence: crudInfo ? 0.85 : 0.75,
    });
  }

  return results;
}

// ─── Deduplication ───────────────────────────────────────────────────────────

function deduplicateInteractions(interactions: RawInteraction[]): RawInteraction[] {
  // Deduplicate by file + functionName — one event per handler/operation.
  // When confidence differs, keep the higher-confidence match.
  const byKey = new Map<string, RawInteraction>();

  for (const interaction of interactions) {
    const key = `${interaction.file}::${interaction.functionName}`;
    const existing = byKey.get(key);
    if (!existing || interaction.confidence > existing.confidence) {
      byKey.set(key, interaction);
    }
  }

  return Array.from(byKey.values());
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if the character at matchIndex in content is inside a string literal,
 * single-line comment, or block comment.
 */
function isInsideStringOrComment(content: string, matchIndex: number): boolean {
  const before = content.substring(0, matchIndex);

  // Fast path: line starts with a comment marker
  const lastNl = before.lastIndexOf('\n');
  const lineStart = before.substring(lastNl + 1);
  if (/^\s*(\/\/|\*)/.test(lineStart)) return true;

  // Inline // comment before the match on this line
  const inlineCommentIdx = lineStart.indexOf('//');
  if (inlineCommentIdx !== -1) {
    const beforeComment = lineStart.substring(0, inlineCommentIdx);
    const singleCount = (beforeComment.match(/'/g) ?? []).length;
    const doubleCount = (beforeComment.match(/"/g) ?? []).length;
    if (singleCount % 2 === 0 && doubleCount % 2 === 0) return true;
  }

  // Unclosed block comment /* … */
  const lastOpen = before.lastIndexOf('/*');
  if (lastOpen !== -1) {
    const lastClose = before.lastIndexOf('*/');
    if (lastClose < lastOpen) return true;
  }

  // Walk content tracking string state
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === '\\' && (inSingle || inDouble || inTemplate)) { i++; continue; }
    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === "'") inSingle = true;
      else if (ch === '"') inDouble = true;
      else if (ch === '`') inTemplate = true;
    } else if (inSingle && ch === "'") { inSingle = false; }
    else if (inDouble && ch === '"') { inDouble = false; }
    else if (inTemplate && ch === '`') { inTemplate = false; }
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
  // .mutate/.mutateAsync calls are already caught by detectMutationHooks
  if (expr.includes('.mutate(') || expr.includes('.mutateAsync(')) return null;

  // Direct handler name: handleFoo
  if (/^handle[A-Za-z0-9_]+$/.test(expr)) return expr;

  // Arrow fn with explicit handler ref: () => handleFoo() or (e) => handleFoo(e)
  const arrowHandlerMatch = expr.match(/^\([^)]*\)\s*=>\s*(handle[A-Za-z0-9_]+)\s*\(/);
  if (arrowHandlerMatch) return arrowHandlerMatch[1];

  // Arrow fn calling a simple function: () => doThing() — extract just the function name
  const simpleFnCall = expr.match(/^\([^)]*\)\s*=>\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\(/);
  if (simpleFnCall) return simpleFnCall[1];

  // Inline expression referencing a handle function somewhere
  const arrowMatch = expr.match(/handle[A-Za-z0-9_]+/);
  return arrowMatch?.[0] ?? null;
}

function extractUiHint(context: string): string | undefined {
  const ariaMatch = context.match(/aria-label=['"]([^'"]{2,60})['"]/);
  if (ariaMatch) return ariaMatch[1];
  const titleMatch = context.match(/title=['"]([^'"]{2,60})['"]/);
  if (titleMatch) return titleMatch[1];
  const btnText = context.match(/<[Bb]utton[^>]*>\s*([A-Za-z][^<\n]{2,40}?)\s*</);
  if (btnText) return btnText[1].trim();
  return undefined;
}

function extractEntitiesFromName(name: string): string[] {
  const stripped = name.replace(/^(handle|on)/i, '');
  if (!stripped) return [];
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
  return routePath
    .split('/')
    .filter((p) => p && !p.startsWith(':') && !['api', 'v1', 'v2', 'v3'].includes(p))
    .flatMap((p) => p.replace(/-/g, '_').split('_'))
    .map((p) => p.replace(/s$/, ''))
    .filter((p) => p.length >= 3);
}

function findEnclosingFunction(lines: string[], lineNumber: number): string | null {
  const BUILTIN = new Set(['Promise', 'Error', 'Object', 'Array', 'Function', 'if', 'for', 'while', 'switch']);
  const funcPattern = /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(?:const|let|var)\s+(\w+)\s*=\s*async\s+\()/;
  for (let i = Math.min(lineNumber - 1, lines.length - 1); i >= 0; i--) {
    const m = lines[i].match(funcPattern);
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
  const cleanUrl = url.split('?')[0];
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
