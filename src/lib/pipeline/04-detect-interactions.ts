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
    interactions.push(...detectToggles(file, content, lines));
  }

  return deduplicateInteractions(interactions);
}

// ─── Per-pattern detectors ───

function detectClickHandlers(file: FileContent, content: string, lines: string[]): RawInteraction[] {
  const results: RawInteraction[] = [];
  const pattern = /onClick\s*=\s*\{([^}]+)\}/g;
  let m: RegExpExecArray | null;

  while ((m = pattern.exec(content)) !== null) {
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

// ─── Deduplication ───

function deduplicateInteractions(interactions: RawInteraction[]): RawInteraction[] {
  // Deduplicate by file + functionName; keep the one with higher confidence
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

// ─── Helpers ───

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
