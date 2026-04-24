import OpenAI from 'openai';
import type { ProductProfile, CodeLocation, SignalType, FileContent } from '../types';
import type { RawInteraction, SynthesizedEvent, PropertySpec } from './types';
import {
  extractLikelyObjectFromPath,
  isValidEventName,
  isBusinessEvent,
  toSnakeCaseFromPascalOrCamel,
  toSnakeCaseFromWords,
} from '../utils/event-name';
import { llmCall } from '../utils/llm';

/**
 * Convert raw interactions into synthesized events.
 * In fast mode (no API key), uses regex-based naming heuristics.
 * In LLM mode, uses OpenAI to group interactions into business events with better names.
 */
export async function synthesizeEvents(
  interactions: RawInteraction[],
  profile: ProductProfile,
  options: { fast?: boolean; apiKey?: string; granular?: boolean; verbose?: boolean; files?: FileContent[] }
): Promise<SynthesizedEvent[]> {
  const files = options.files ?? [];

  let events: SynthesizedEvent[];
  if (options.fast || !options.apiKey) {
    events = regexFallbackSynthesis(interactions, { granular: options.granular });
  } else {
    events = await llmSynthesis(interactions, profile, options.apiKey, options.granular, options.verbose);
  }

  // Attach properties from source-code analysis when file contents are available.
  if (files.length > 0) {
    for (const event of events) {
      const primaryIdx = event.sourceInteractions[0];
      if (primaryIdx !== undefined) {
        const primary = interactions[primaryIdx];
        if (primary) {
          event.properties = extractPropertiesFromInteraction(primary, files);
        }
      }
    }
  }

  return events;
}

function regexFallbackSynthesis(
  interactions: RawInteraction[],
  options?: { granular?: boolean }
): SynthesizedEvent[] {
  const granular = Boolean(options?.granular);
  const events: SynthesizedEvent[] = [];

  for (let i = 0; i < interactions.length; i++) {
    const interaction = interactions[i];
    const name = guessEventName(interaction);
    if (!name) continue;
    if (!isValidEventName(name)) continue;
    if (!isBusinessEvent(name)) continue;

    events.push({
      name,
      description: `${interaction.type}: ${interaction.functionName}`,
      priority: scorePriority(name, interaction),
      signalType: inferSignalType(interaction.type),
      sourceInteractions: [i],
      location: {
        file: interaction.file,
        line: interaction.line,
        context: interaction.codeContext,
        confidence: interaction.confidence,
        hint: interaction.triggerExpression,
      },
    });
  }

  const deduped = deduplicateEvents(events);
  return granular ? deduped : groupBusinessEdits(deduped);
}

async function llmSynthesis(
  interactions: RawInteraction[],
  profile: ProductProfile,
  apiKey: string,
  granular?: boolean,
  verbose?: boolean
): Promise<SynthesizedEvent[]> {
  if (interactions.length === 0) return [];

  const batchSize = 30;
  const allEvents: SynthesizedEvent[] = [];
  const coveredIndices = new Set<number>();

  for (let start = 0; start < interactions.length; start += batchSize) {
    const end = Math.min(start + batchSize, interactions.length);
    const batchInteractions = interactions.slice(start, end);
    const summaries = batchInteractions.map((r, i) => ({
      index: start + i,
      type: r.type,
      file: r.file,
      functionName: r.functionName,
      entities: r.relatedEntities ?? [],
      uiHint: r.uiHint ?? '',
      suggestedEvent: guessEventName(r),
      preGroupKey: buildPreGroupKey(r),
      snippet: r.codeContext.split('\n').slice(0, 5).join('\n'),
    }));

    const prompt = buildSynthesisPrompt(profile, summaries, Boolean(granular));
    const response = await llmCall<{ events?: Array<{
      name?: unknown;
      description?: unknown;
      priority?: unknown;
      sourceInteractions?: unknown;
      includes?: unknown;
    }> }>({
      apiKey,
      system: 'You are a product analytics expert. Return only valid JSON.',
      prompt,
      model: 'gpt-4o-mini',
      temperature: 0.3,
      verbose: Boolean(verbose),
      fallback: { events: [] },
    });

    for (const raw of response.events ?? []) {
      if (typeof raw.name !== 'string') continue;
      if (!isValidEventName(raw.name) || !isBusinessEvent(raw.name)) continue;

      const sourceInteractions = Array.isArray(raw.sourceInteractions)
        ? raw.sourceInteractions.filter((v): v is number => typeof v === 'number')
        : [];

      const validSource = sourceInteractions
        .filter((idx) => idx >= start && idx < end)
        .filter((idx, idxPos, arr) => arr.indexOf(idx) === idxPos);

      if (validSource.length === 0) continue;

      for (const idx of validSource) coveredIndices.add(idx);
      const primaryInteractionType = validSource.length > 0 ? interactions[validSource[0]]?.type : undefined;
      allEvents.push({
        name: raw.name,
        description:
          typeof raw.description === 'string' && raw.description.trim()
            ? raw.description
            : `Business interaction: ${raw.name}`,
        priority: toPriority(raw.priority),
        signalType: inferSignalType(primaryInteractionType),
        sourceInteractions: validSource,
        includes: Array.isArray(raw.includes)
          ? raw.includes.filter((x): x is string => typeof x === 'string')
          : undefined,
        location: pickBestLocation(validSource, interactions),
      });
    }
  }

  // Any interactions not covered by the model still get regex fallback naming.
  const uncovered: SynthesizedEvent[] = [];
  for (let i = 0; i < interactions.length; i++) {
    if (coveredIndices.has(i)) continue;
    const interaction = interactions[i];
    const name = guessEventName(interaction);
    if (!name || !isValidEventName(name) || !isBusinessEvent(name)) continue;
    uncovered.push({
      name,
      description: `${interaction.type}: ${interaction.functionName}`,
      priority: scorePriority(name, interaction),
      signalType: inferSignalType(interaction.type),
      sourceInteractions: [i],
      location: {
        file: interaction.file,
        line: interaction.line,
        context: interaction.codeContext,
        confidence: interaction.confidence,
        hint: interaction.triggerExpression,
      },
    });
  }

  const merged = deduplicateEvents([...allEvents, ...uncovered]);
  return granular ? merged : groupBusinessEdits(merged);
}

function buildSynthesisPrompt(
  profile: ProductProfile,
  interactionSummaries: Array<{
    index: number;
    type: string;
    file: string;
    functionName: string;
    entities: string[];
    uiHint: string;
    suggestedEvent: string | null;
    preGroupKey: string;
    snippet: string;
  }>,
  granular: boolean
): string {
  return `You are a product analytics expert. Given a product description and a list of code interactions detected in the codebase, determine which interactions should be tracked as analytics events.

Product:
- Mission: ${profile.mission}
- Key Metrics: ${(profile.keyMetrics ?? []).join(', ') || 'unknown'}
- Business Goals: ${(profile.businessGoals ?? []).join(', ') || 'unknown'}

Detected interactions:
${JSON.stringify(interactionSummaries, null, 2)}

For each interaction (or group of related interactions), decide:
1. Should it be tracked? Not everything needs an event. Skip pure UI/cosmetic interactions.
2. What business event name? Use object_action format (snake_case). Examples: workflow_created, template_selected, step_configured.
3. Priority: critical (activation events), high (core usage), medium (secondary features), low (settings/UI).
4. ${granular ? 'Keep each interaction as a separate event.' : 'Group related interactions into single business events where it makes sense. Use preGroupKey and suggestedEvent as hints for likely grouping, but feel free to adjust.'}

Rules:
- NEVER produce garbage names like save_saved, add_added, click_clicked
- Name from the USER's perspective, not the code's perspective
- object_action format: the object is the business entity, the action is past tense
- Include a clear description of what the event means in business terms
- sourceInteractions MUST reference the provided interaction index values only

Return JSON only:
{
  "events": [
    {
      "name": "workflow_edited",
      "description": "User modified their workflow configuration",
      "priority": "high",
      "sourceInteractions": [0, 1, 2],
      "includes": ["add_mapping", "remove_mapping"]
    }
  ]
}`;
}

function pickBestLocation(sourceInteractions: number[], interactions: RawInteraction[]): CodeLocation {
  let best = interactions[sourceInteractions[0]];
  for (const index of sourceInteractions) {
    const candidate = interactions[index];
    if (candidate.confidence > best.confidence) best = candidate;
  }
  return {
    file: best.file,
    line: best.line,
    context: best.codeContext,
    confidence: best.confidence,
    hint: best.triggerExpression,
  };
}

function toPriority(value: unknown): SynthesizedEvent['priority'] {
  return value === 'critical' || value === 'high' || value === 'medium' || value === 'low'
    ? value
    : 'medium';
}

function scorePriority(eventName: string, interaction: RawInteraction): SynthesizedEvent['priority'] {
  const n = eventName.toLowerCase();
  const isWrite = /_(created|deleted|updated|saved|submitted|upgraded|invited)$/.test(n);
  const isActivationLike = /(signup|signed_up|onboard|activated|upgrade|upgraded|subscribe|subscribed|purchase|purchased|payment|paid)/.test(n);
  const isUiOnly = interaction.type === 'toggle' || interaction.type === 'click_handler';

  if (isActivationLike) return 'critical';
  if (isWrite && (interaction.type === 'mutation' || interaction.type === 'route_handler')) return 'high';
  if (isWrite) return 'medium';
  if (isUiOnly) return 'low';
  return 'medium';
}

export function inferSignalType(interactionType: RawInteraction['type'] | undefined): SignalType {
  switch (interactionType) {
    case 'click_handler':
    case 'form_submit':
    case 'toggle':
    case 'route_handler':
    case 'mutation':
      return 'action';
    case 'lifecycle':
    case 'state_change':
      return 'state_change';
    case 'error_boundary':
      return 'error';
    case 'api_call':
    case 'retry_logic':
    case 'job_handler':
      return 'operation';
    default:
      return 'action';
  }
}

function buildPreGroupKey(interaction: RawInteraction): string {
  const entity = interaction.relatedEntities?.[0] ?? extractLikelyObjectFromPath(interaction.file) ?? 'unknown';
  const file = interaction.file.split(/[\\/]/).pop() ?? interaction.file;
  return `${file}::${entity}`;
}

function groupBusinessEdits(events: SynthesizedEvent[]): SynthesizedEvent[] {
  const isEditLike = (name: string): boolean => /_(updated|saved|added|removed|changed|toggled|enabled|disabled)$/.test(name);
  const isCreateDelete = (name: string): boolean => /_(created|deleted)$/.test(name);

  const groups = new Map<string, SynthesizedEvent[]>();
  const passthrough: SynthesizedEvent[] = [];

  for (const ev of events) {
    const key = `${ev.location.file}::${extractObject(ev.name)}`;
    if (!isValidEventName(ev.name) || !isBusinessEvent(ev.name)) {
      passthrough.push(ev);
      continue;
    }
    if (isCreateDelete(ev.name) || !isEditLike(ev.name)) {
      passthrough.push(ev);
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(ev);
    groups.set(key, list);
  }

  const out: SynthesizedEvent[] = [...passthrough];

  for (const [key, list] of groups) {
    if (list.length <= 1) {
      out.push(list[0]);
      continue;
    }
    const object = key.split('::')[1] || 'item';
    const name = `${object}_edited`;
    if (!isValidEventName(name) || !isBusinessEvent(name)) {
      out.push(...list);
      continue;
    }

    const sourceInteractions = Array.from(new Set(list.flatMap((e) => e.sourceInteractions)));
    const includes = Array.from(new Set(list.map((e) => e.name)));
    const best = list.reduce((a, b) => ((b.location.confidence ?? 0) > (a.location.confidence ?? 0) ? b : a));

    out.push({
      name,
      description: `User edited ${object} (grouped changes)`,
      priority: 'high',
      signalType: 'action',
      sourceInteractions,
      includes,
      location: best.location,
    });
  }

  return deduplicateEvents(out);
}

function extractObject(eventName: string): string {
  const parts = eventName.split('_').filter(Boolean);
  if (parts.length < 2) return 'item';
  return parts.slice(0, -1).join('_') || 'item';
}

/**
 * Best-effort event name from a raw interaction.
 * Same logic as the old InteractionScanner's parseHandlerName.
 */
function guessEventName(interaction: RawInteraction): string | null {
  // Operational types get domain-specific naming before generic handler parsing.
  if (interaction.type === 'error_boundary') return guessErrorBoundaryName(interaction);
  if (interaction.type === 'api_call') return guessAPICallName(interaction);
  if (interaction.type === 'retry_logic') return guessRetryName(interaction);
  if (interaction.type === 'job_handler') return guessJobHandlerName(interaction);

  if (interaction.type === 'route_handler') {
    return guessRouteEventName(interaction);
  }
  if (interaction.type === 'mutation') {
    return guessMutationEventName(interaction);
  }

  // Prefer UI hints (button text / aria-label) when available.
  // Example: "Save Workflow" -> workflow_saved
  const uiEvent = guessFromUiHint(interaction);
  if (uiEvent) return uiEvent;

  const handler = interaction.functionName;

  // Strip "handle"/"on"/"use" prefix
  let name = handler.replace(/^handle/, '').replace(/^on/, '').replace(/^use/, '');
  if (!name) return null;

  // VerbObject: CreateWorkflow → workflow_created
  const verbObjectMatch = name.match(
    /^(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable|Upgrade|Invite)(.+)$/i
  );
  if (verbObjectMatch) {
    const verb = verbObjectMatch[1].toLowerCase();
    const object = toSnakeCaseFromPascalOrCamel(verbObjectMatch[2]);
    const pastVerb = toPastTense(verb);
    return `${object}_${pastVerb}`;
  }

  // ObjectVerb: MappingChange → mapping_changed
  const objectVerbMatch = name.match(
    /^(.*?)(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable|Change|Upgrade|Invite)$/i
  );
  if (objectVerbMatch && objectVerbMatch[1]) {
    const object = toSnakeCaseFromPascalOrCamel(objectVerbMatch[1]);
    const verb = objectVerbMatch[2].toLowerCase();
    const pastVerb = toPastTense(verb);
    return `${object}_${pastVerb}`;
  }

  // No valid event name could be inferred — drop this interaction rather than
  // emitting garbage names like "workflow_interacted".
  return null;
}

// Generic utility function names that shouldn't become event name prefixes
const OPERATIONAL_UTIL_NAMES = new Set([
  'errhandler', 'errorhandler', 'catchhandler', 'apicall', 'retryhandler',
  'jobhandler', 'withretry', 'retry', 'backoff', 'processjob',
]);

function cleanOperationalFunctionName(fn: string): string | null {
  const stripped = fn.replace(/^(handle|on)/i, '');
  const snaked = toSnakeCaseFromPascalOrCamel(stripped);
  if (!snaked || snaked.length < 3) return null;
  if (OPERATIONAL_UTIL_NAMES.has(snaked.replace(/_/g, ''))) return null;
  return snaked;
}

function pickEntity(relatedEntities: string[] | undefined): string | null {
  // Skip generic utility words that would produce bad names (e.g., "retry_retried")
  const SKIP = new Set(['retry', 'error', 'catch', 'job', 'handler', 'util', 'helper']);
  for (const raw of relatedEntities ?? []) {
    const e = raw.toLowerCase();
    if (e.length >= 3 && !SKIP.has(e)) return e;
  }
  return null;
}

function guessErrorBoundaryName(interaction: RawInteraction): string | null {
  const fn = interaction.functionName;
  if (fn && fn !== 'errorHandler' && fn !== 'catchHandler') {
    const snaked = cleanOperationalFunctionName(fn);
    if (snaked) return `${snaked}_failed`;
  }
  const entity = pickEntity(interaction.relatedEntities);
  if (entity) return `${entity}_failed`;
  return null;
}

function guessAPICallName(interaction: RawInteraction): string | null {
  const entity = pickEntity(interaction.relatedEntities);
  if (entity) return `${entity}_fetched`;
  const fn = interaction.functionName;
  if (fn && fn !== 'apiCall') {
    const snaked = cleanOperationalFunctionName(fn);
    if (snaked) return `${snaked}_fetched`;
  }
  return null;
}

function guessRetryName(interaction: RawInteraction): string | null {
  const entity = pickEntity(interaction.relatedEntities);
  if (entity) return `${entity}_retried`;
  const fn = interaction.functionName;
  if (fn && fn !== 'retryHandler') {
    const snaked = cleanOperationalFunctionName(fn);
    if (snaked) return `${snaked}_retried`;
  }
  return null;
}

function guessJobHandlerName(interaction: RawInteraction): string | null {
  const fn = interaction.functionName;
  if (fn && fn !== 'jobHandler') {
    const snaked = fn.replace(/-/g, '_').replace(/\s+/g, '_').toLowerCase();
    if (snaked && snaked.length >= 3 && !OPERATIONAL_UTIL_NAMES.has(snaked.replace(/_/g, ''))) {
      return `${snaked}_processed`;
    }
  }
  const entity = pickEntity(interaction.relatedEntities);
  if (entity) return `${entity}_processed`;
  return null;
}

function guessRouteEventName(interaction: RawInteraction): string | null {
  // interaction.functionName is usually like: "POST /api/workflows" or "PATCH /projects/:id/tasks"
  const match = interaction.functionName.match(/^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i);
  if (!match) return null;

  const method = match[1].toUpperCase();
  const routePath = match[2] ?? '';

  // Prefer last non-param segment, skipping common prefixes like `api` and version segments.
  const segments = routePath
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.startsWith(':'))
    .filter((s) => !/^v\d+$/i.test(s))
    .filter((s) => s.toLowerCase() !== 'api');

  const last = segments[segments.length - 1] ?? null;
  if (!last) return null;

  const resource = last.replace(/-/g, '_').replace(/s$/, '');

  const methodToVerb: Record<string, string> = {
    POST: 'created',
    PUT: 'updated',
    PATCH: 'updated',
    DELETE: 'deleted',
  };

  const verb = methodToVerb[method];
  if (!verb) return null; // GET routes usually aren't tracked

  return `${resource}_${verb}`;
}

function guessMutationEventName(interaction: RawInteraction): string | null {
  // Generic CRUD format from detectGenericCRUD: "entity.op" (e.g. "issue.insert", "cycle.delete")
  const genericMatch = interaction.functionName.match(/^([a-z][a-z0-9_]*)\.(create|insert|update|delete|upsert|remove|destroy|save)$/i);
  if (genericMatch) {
    const entity = genericMatch[1].replace(/s$/, '');
    const rawVerb = genericMatch[2].toLowerCase();
    const verb = rawVerb === 'insert' ? 'create'
      : rawVerb === 'destroy' || rawVerb === 'remove' ? 'delete'
      : rawVerb;
    return `${entity}_${toPastTense(verb)}`;
  }

  const prismaMatch = interaction.functionName.match(/prisma\.(\w+)\.(create|update|delete|upsert)/i);
  if (prismaMatch) {
    const entity = toSnakeCaseFromPascalOrCamel(prismaMatch[1]);
    const verb = toPastTense(prismaMatch[2]);
    return `${entity}_${verb}`;
  }

  const supabaseMatch = interaction.functionName.match(/from\(['"](\w+)['"]\)\.(insert|update|delete)/i);
  if (supabaseMatch) {
    const entity = supabaseMatch[1].replace(/s$/, '').replace(/-/g, '_');
    const verb = toPastTense(supabaseMatch[2] === 'insert' ? 'create' : supabaseMatch[2]);
    return `${entity}_${verb}`;
  }

  const drizzleMatch = interaction.functionName.match(/db\.(insert|update|delete)\((\w+)\)/i);
  if (drizzleMatch) {
    const entity = drizzleMatch[2].replace(/s$/, '');
    const verb = toPastTense(drizzleMatch[1] === 'insert' ? 'create' : drizzleMatch[1]);
    return `${entity}_${verb}`;
  }

  return null;
}

function toPastTense(verb: string): string {
  const map: Record<string, string> = {
    create: 'created', add: 'added', delete: 'deleted', remove: 'removed',
    update: 'updated', save: 'saved', submit: 'submitted', start: 'started',
    stop: 'stopped', test: 'tested', select: 'selected', toggle: 'toggled',
    enable: 'enabled', disable: 'disabled', cancel: 'cancelled', close: 'closed',
    open: 'opened', change: 'changed', upsert: 'upserted', insert: 'created',
    upgrade: 'upgraded', invite: 'invited',
  };
  return map[verb.toLowerCase()] ?? `${verb.toLowerCase()}ed`;
}

function guessFromUiHint(interaction: RawInteraction): string | null {
  const hint = (interaction.uiHint ?? '').trim();
  if (!hint) return null;

  // Common patterns: "Save Workflow", "Enable Notifications", "Upgrade Plan"
  const match = hint.match(
    /^(Save|Create|Update|Add|Remove|Delete|Start|Stop|Select|Toggle|Enable|Disable|Submit|Upgrade|Invite|Cancel|Close|Open|Change)\s+(.+)$/i
  );
  if (!match) return null;

  const verb = match[1].toLowerCase();
  const objectText = match[2].replace(/\s+/g, ' ').trim();
  const words = objectText.split(' ').map((w) => w.replace(/[^a-zA-Z0-9]/g, '').trim()).filter(Boolean);
  if (words.length === 0) return null;
  const object = toSnakeCaseFromWords(words);
  if (!object) return null;

  const pastVerb = toPastTense(verb);
  const candidate = `${object}_${pastVerb}`;
  if (!isValidEventName(candidate) || !isBusinessEvent(candidate)) return null;
  return candidate;
}

// ─── Property extraction from source code ────────────────────────────────────

/**
 * Extracts analytics properties from the source code at an interaction's location.
 *
 * Three extraction passes (in order):
 *   1. Typed inline parameter — `async (arg: { prop: type }) =>` → extract props + types
 *   2. Untyped parameter usage — `async (arg) =>` → scan body for `arg.prop` patterns
 *   3. Database return destructuring — `const { data } = await client.from(…)` → add entity_id
 */
export function extractPropertiesFromInteraction(
  interaction: RawInteraction,
  files: FileContent[]
): PropertySpec[] {
  const file = files.find((f) => f.path === interaction.file);
  const fullContent = file?.content ?? interaction.codeContext;
  const lines = fullContent.split('\n');

  // Use a generous window so multi-line mutationFn bodies are fully captured.
  const lo = Math.max(0, interaction.line - 6);
  const hi = Math.min(lines.length, interaction.line + 80);
  const body = lines.slice(lo, hi).join('\n');

  const props: PropertySpec[] = [];
  const seen = new Set<string>();

  function add(p: PropertySpec): void {
    if (!seen.has(p.name)) { seen.add(p.name); props.push(p); }
  }

  // Pass 1: typed inline parameter
  //   mutationFn: async (arg: { email: string; role: 'admin' | 'member' }) =>
  //   async (arg: { email: string }) =>
  const typedMatch = body.match(
    /(?:mutationFn\s*:\s*)?async\s*\(\s*(\w+)\s*:\s*\{([^}]+)\}\s*\)\s*=>/
  );
  if (typedMatch) {
    const argName = typedMatch[1];
    const typeBody = typedMatch[2];
    for (const field of typeBody.split(/[;,]/)) {
      const fm = field.trim().match(/^(\w+)\??\s*:\s*(.+)$/);
      if (!fm) continue;
      const name = fm[1].trim();
      if (!name || name.length < 2) continue;
      add({
        name,
        type: normalizePropertyType(fm[2]),
        required: !field.trim().includes('?:'),
        description: `from ${argName} parameter`,
        accessPath: `${argName}.${name}`,
        verified: true,
      });
    }
  } else {
    // Pass 2: untyped parameter — scan body for arg.prop usages
    const untypedMatch = body.match(
      /(?:mutationFn\s*:\s*)?async\s*\(\s*(\w+)\s*\)\s*=>/
    );
    if (untypedMatch) {
      const argName = untypedMatch[1];
      const SKIP_ARGS = new Set(['e', 'ev', 'event', 'req', 'res', 'ctx', 'context', 'err', 'error']);
      if (!SKIP_ARGS.has(argName)) {
        const usageRe = new RegExp(`\\b${argName}\\.([a-zA-Z][a-zA-Z0-9_]*)`, 'g');
        const SKIP_PROPS = new Set(['id', 'then', 'catch', 'finally', 'call', 'apply']);
        let um: RegExpExecArray | null;
        while ((um = usageRe.exec(body)) !== null) {
          const prop = um[1];
          if (SKIP_PROPS.has(prop)) continue;
          add({
            name: prop,
            type: 'string',
            required: true,
            description: `from ${argName} usage`,
            accessPath: `${argName}.${prop}`,
            verified: true,
          });
        }
      }
    }
  }

  // Pass 3: database return — const { data } = await client.from(...)
  if (/const\s*\{\s*data\b[^}]*\}\s*=\s*await\s+\w+\./.test(body)) {
    const entity = interaction.relatedEntities?.[0];
    if (entity) {
      add({
        name: `${entity}_id`,
        type: 'string',
        required: false,
        description: 'from insert return data',
        accessPath: 'data?.id',
        verified: true,
      });
    }
  }

  return props;
}

function normalizePropertyType(rawType: string): PropertySpec['type'] {
  const t = rawType.trim().toLowerCase().replace(/\s+/g, '');
  if (t === 'number' || t === 'int' || t === 'float' || t === 'bigint') return 'number';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t.endsWith('[]') || t.startsWith('array')) return 'array';
  return 'string'; // covers 'string', union literals, and unknown types
}

const CREATION_VERBS = new Set(['created', 'added', 'inserted']);
const DELETION_VERBS = new Set(['deleted', 'removed', 'destroyed']);

function canonicalVerbKey(verb: string): string {
  if (CREATION_VERBS.has(verb)) return 'created';
  if (DELETION_VERBS.has(verb)) return 'deleted';
  return verb;
}

function mergeInto(target: Map<string, SynthesizedEvent>, key: string, event: SynthesizedEvent): void {
  const existing = target.get(key);
  if (!existing) {
    target.set(key, event);
  } else if ((event.location.confidence ?? 0) > (existing.location.confidence ?? 0)) {
    target.set(key, {
      ...event,
      sourceInteractions: [...new Set([...existing.sourceInteractions, ...event.sourceInteractions])],
    });
  } else {
    existing.sourceInteractions = [...new Set([...existing.sourceInteractions, ...event.sourceInteractions])];
  }
}

function deduplicateEvents(events: SynthesizedEvent[]): SynthesizedEvent[] {
  // Pass 1: exact name deduplication
  const byName = new Map<string, SynthesizedEvent>();
  for (const event of events) {
    mergeInto(byName, event.name.toLowerCase(), event);
  }

  // Pass 2: synonym-verb deduplication
  // e.g. comment_created and comment_added → keep higher-confidence one
  const bySynonym = new Map<string, SynthesizedEvent>();
  for (const event of byName.values()) {
    const parts = event.name.split('_');
    const verb = parts[parts.length - 1];
    const object = parts.slice(0, -1).join('_');
    const synKey = `${object}:${canonicalVerbKey(verb)}`;
    mergeInto(bySynonym, synKey, event);
  }

  return Array.from(bySynonym.values());
}

