/**
 * InteractionScanner: heuristically extracts user interactions from code (UI handlers, etc.)
 *
 * Note: logline_old did not contain this file; this is a lightweight implementation
 * to enable the unified scan pipeline requested.
 */

import type { CodeLocation, FileContent } from '../types';
import {
  extractLikelyObjectFromPath,
  isBusinessEvent,
  isValidEventName,
  toSnakeCaseFromPascalOrCamel,
} from '../utils/event-name';

export type InteractionTypes = {
  actorToObject: Array<{
    actor: 'User' | 'System';
    action: string;
    object: string;
    suggestedEvent: string;
    ambiguous?: boolean;
    rawHandler?: string;
    location?: CodeLocation;
    searchPatterns?: string[];
    hint?: string;
  }>;
  actorToActor: Array<any>;
  actorToActorViaObject: Array<any>;
  systemToObject: Array<any>;
};

export class InteractionScanner {
  async scan(files: FileContent[]): Promise<InteractionTypes> {
    const actorToObject: InteractionTypes['actorToObject'] = [];

    for (const file of files) {
      // Keep it UI-focused by default
      if (!file.path.match(/\.(ts|tsx|js|jsx)$/)) continue;
      if (file.path.includes('node_modules') || file.path.includes('dist') || file.path.includes('build')) continue;

      const content = file.content;
      const lines = content.split('\n');

      // 1) onClick handlers: onClick={handleX} / onClick={() => handleX(...)}
      const onClick = /onClick\s*=\s*\{([^}]+)\}/g;
      let m: RegExpExecArray | null;
      while ((m = onClick.exec(content)) !== null) {
        const expr = m[1].trim();
        const handler = extractHandlerName(expr);
        if (!handler) continue;

        const loc = buildLoc(file.path, content, m.index, lines);
        const { suggestedEvent, ambiguous } = parseHandlerName(handler, {
          filePath: file.path,
          snippet: loc.context ?? '',
        });
        if (!suggestedEvent) continue;
        if (!isBusinessEvent(suggestedEvent)) continue;

        actorToObject.push({
          actor: 'User',
          action: 'clicks',
          object: inferObjectFromEvent(suggestedEvent),
          suggestedEvent,
          ambiguous,
          rawHandler: handler,
          location: { ...loc, hint: `onClick={${expr}}`, confidence: 0.85 },
          searchPatterns: [`${handler}(`, `onClick`, handler],
        });
      }

      // 2) handler functions: const handleX = (...) => { ... }
      const handlerDecl = /\bconst\s+(handle[A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
      while ((m = handlerDecl.exec(content)) !== null) {
        const handler = m[1];
        const loc = buildLoc(file.path, content, m.index, lines);
        const { suggestedEvent, ambiguous } = parseHandlerName(handler, {
          filePath: file.path,
          snippet: loc.context ?? '',
        });
        if (!suggestedEvent) continue;
        if (!isBusinessEvent(suggestedEvent)) continue;

        actorToObject.push({
          actor: 'User',
          action: inferActionWord(suggestedEvent),
          object: inferObjectFromEvent(suggestedEvent),
          suggestedEvent,
          ambiguous,
          rawHandler: handler,
          location: { ...loc, hint: `function:${handler}`, confidence: 0.55 },
          searchPatterns: [handler],
        });
      }

      // 3) onSubmit
      const onSubmit = /onSubmit\s*=\s*\{([^}]+)\}/g;
      while ((m = onSubmit.exec(content)) !== null) {
        const expr = m[1].trim();
        const handler = extractHandlerName(expr);
        if (!handler) continue;

        const loc = buildLoc(file.path, content, m.index, lines);
        const guessed = parseHandlerName(handler, { filePath: file.path, snippet: loc.context ?? '' });
        const suggestedEvent = guessed.suggestedEvent ?? 'form_submitted';
        const ambiguous = guessed.suggestedEvent ? guessed.ambiguous : true;
        if (suggestedEvent && !isBusinessEvent(suggestedEvent)) continue;

        actorToObject.push({
          actor: 'User',
          action: 'submits',
          object: 'Form',
          suggestedEvent,
          ambiguous,
          rawHandler: handler,
          location: { ...loc, hint: `onSubmit={${expr}}`, confidence: 0.85 },
          searchPatterns: [`${handler}(`, 'onSubmit'],
        });
      }

      // 4) toggles: onCheckedChange={...}
      const onChecked = /onCheckedChange\s*=\s*\{([^}]+)\}/g;
      while ((m = onChecked.exec(content)) !== null) {
        const expr = m[1].trim();
        const handler = extractHandlerName(expr);
        if (!handler) continue;

        const loc = buildLoc(file.path, content, m.index, lines);
        const guessed = parseHandlerName(handler, { filePath: file.path, snippet: loc.context ?? '' });
        const suggestedEvent = guessed.suggestedEvent ?? 'toggle_changed';
        const ambiguous = guessed.suggestedEvent ? guessed.ambiguous : true;
        if (suggestedEvent && !isBusinessEvent(suggestedEvent)) continue;

        actorToObject.push({
          actor: 'User',
          action: 'toggles',
          object: 'Toggle',
          suggestedEvent,
          ambiguous,
          rawHandler: handler,
          location: { ...loc, hint: `onCheckedChange={${expr}}`, confidence: 0.8 },
          searchPatterns: [`${handler}(`, 'onCheckedChange'],
        });
      }
    }

    // Dedup: keep best location per suggestedEvent
    const byEvent = new Map<string, (typeof actorToObject)[number]>();
    for (const it of actorToObject) {
      const key = it.suggestedEvent.toLowerCase();
      const existing = byEvent.get(key);
      if (!existing) {
        byEvent.set(key, it);
        continue;
      }
      if (interactionLocationScore(it) > interactionLocationScore(existing)) {
        byEvent.set(key, it);
      }
    }
    const deduped = Array.from(byEvent.values());

    return {
      actorToObject: deduped,
      actorToActor: [],
      actorToActorViaObject: [],
      systemToObject: [],
    };
  }
}

function buildLoc(file: string, content: string, index: number, lines: string[]): CodeLocation {
  const line = content.substring(0, index).split('\n').length; // 1-indexed
  const start = Math.max(0, line - 3);
  const end = Math.min(lines.length, line + 2);
  const context = lines.slice(start, end).join('\n');
  return { file, line, context };
}

function extractHandlerName(expr: string): string | null {
  // handleFoo
  if (/^handle[A-Za-z0-9_]+$/.test(expr)) return expr;

  // () => handleFoo(...)
  const m = expr.match(/handle[A-Za-z0-9_]+/);
  return m?.[0] ?? null;
}

type FileContext = { filePath: string; componentName?: string; snippet?: string };

function parseHandlerName(handlerName: string, fileContext: FileContext): { suggestedEvent: string | null; ambiguous: boolean } {
  let name = handlerName.replace(/^handle/, '').replace(/^on/, '');
  if (!name) return { suggestedEvent: null, ambiguous: true };

  // Pattern 1: VerbObject (CreateWorkflow, RemoveMapping, AddMapping, TestWorkflow)
  const verbObjectMatch = name.match(
    /^(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable)(.+)$/i
  );
  if (verbObjectMatch) {
    const verb = verbObjectMatch[1];
    const object = verbObjectMatch[2];
    const normalizedVerb = normalizeVerb(verb);
    const normalizedObject = toSnakeCaseFromPascalOrCamel(object);
    const candidate = `${normalizedObject}_${normalizedVerb}`;
    if (isValidEventName(candidate)) return { suggestedEvent: candidate, ambiguous: false };
  }

  // Pattern 2: Verb only (Save/Submit/etc) -> infer object
  const verbOnlyMatch = name.match(/^(Save|Submit|Cancel|Close|Open|Delete|Remove)$/i);
  if (verbOnlyMatch) {
    const verb = verbOnlyMatch[1];
    const object = inferObjectFromContext(handlerName, fileContext);
    if (!object) return { suggestedEvent: null, ambiguous: true };
    const candidate = `${object}_${normalizeVerb(verb)}`;
    if (isValidEventName(candidate)) return { suggestedEvent: candidate, ambiguous: true };
    return { suggestedEvent: null, ambiguous: true };
  }

  // Pattern 3: ObjectVerb (MappingChange -> mapping_changed)
  const objectVerbMatch = name.match(
    /^(.*?)(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable|Change)$/i
  );
  if (objectVerbMatch) {
    const object = objectVerbMatch[1];
    const verb = objectVerbMatch[2];
    const normalizedVerb = normalizeVerb(verb);
    const normalizedObject = toSnakeCaseFromPascalOrCamel(object);
    const candidate = `${normalizedObject}_${normalizedVerb}`;
    if (isValidEventName(candidate)) return { suggestedEvent: candidate, ambiguous: true };
  }

  // Fallback: try infer from file and treat handler tail as verb-ish
  const inferredObject = inferObjectFromContext(handlerName, fileContext);
  if (inferredObject) {
    const candidate = `${inferredObject}_acted`;
    if (isValidEventName(candidate)) return { suggestedEvent: candidate, ambiguous: true };
  }

  return { suggestedEvent: null, ambiguous: true };
}

function inferObjectFromContext(handlerName: string, context: FileContext): string | null {
  // Strategy 1: component/file name
  const componentName =
    context.componentName ??
    (context.filePath.split(/[\\/]/).pop() ?? '').replace(/\.(ts|tsx|js|jsx)$/, '');

  if (componentName) {
    const objectName = componentName
      .replace(/Panel$/, '')
      .replace(/Modal$/, '')
      .replace(/Form$/, '')
      .replace(/Dialog$/, '')
      .replace(/Page$/, '');
    const snake = toSnakeCaseFromPascalOrCamel(objectName);
    if (snake && snake.length >= 3 && !['index', 'route', 'page', 'app'].includes(snake)) return snake;
  }

  // Strategy 2: fallback to path-based inference
  const fromPath = extractLikelyObjectFromPath(context.filePath);
  if (fromPath) return fromPath;

  return null;
}

function normalizeVerb(verb: string): string {
  const verbMap: Record<string, string> = {
    create: 'created',
    add: 'added',
    delete: 'deleted',
    remove: 'removed',
    update: 'updated',
    save: 'saved',
    submit: 'submitted',
    start: 'started',
    stop: 'stopped',
    test: 'tested',
    select: 'selected',
    toggle: 'toggled',
    enable: 'enabled',
    disable: 'disabled',
    cancel: 'cancelled',
    close: 'closed',
    open: 'opened',
    change: 'changed',
  };
  const key = verb.toLowerCase();
  return verbMap[key] || `${key}ed`;
}

function interactionLocationScore(it: (InteractionTypes['actorToObject'])[number]): number {
  const hint = (it.location?.hint ?? it.hint ?? '').toLowerCase();
  if (hint.includes('onclick')) return 3;
  if (hint.includes('onsubmit')) return 3;
  if (hint.includes('oncheckedchange')) return 3;
  if (hint.startsWith('function:')) return 1;
  return 0;
}

function mapVerbToSuffix(verb: string): string {
  switch (verb) {
    case 'add':
      return 'added';
    case 'create':
      return 'created';
    case 'delete':
    case 'remove':
      return 'deleted';
    case 'update':
      return 'updated';
    case 'save':
      return 'saved';
    case 'test':
      return 'test_started';
    case 'select':
      return 'selected';
    case 'open':
      return 'opened';
    case 'close':
      return 'closed';
    case 'share':
      return 'shared';
    case 'invite':
      return 'invited';
    default:
      return `${verb}`;
  }
}

function inferObjectFromEvent(eventName: string): string {
  const [entity] = eventName.split('_');
  return entity ? entity[0].toUpperCase() + entity.slice(1) : 'Object';
}

function inferActionWord(eventName: string): string {
  const suffix = eventName.split('_').slice(1).join('_');
  if (suffix.startsWith('created')) return 'creates';
  if (suffix.startsWith('updated')) return 'updates';
  if (suffix.startsWith('deleted')) return 'deletes';
  if (suffix.startsWith('saved')) return 'saves';
  if (suffix.startsWith('selected')) return 'selects';
  if (suffix.startsWith('shared')) return 'shares';
  if (suffix.startsWith('invited')) return 'invites';
  return 'acts_on';
}

