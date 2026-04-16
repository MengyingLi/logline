import OpenAI from 'openai';
import type { ProductProfile, CodeLocation, SignalType } from '../types';
import type { RawInteraction, SynthesizedEvent } from './types';
import {
  extractLikelyObjectFromPath,
  isValidEventName,
  isBusinessEvent,
  toSnakeCaseFromPascalOrCamel,
  toSnakeCaseFromWords,
} from '../utils/event-name';
import { llmCall } from '../utils/llm';

/**
 * TEMPORARY: Convert raw interactions into events using regex-based naming.
 * Day 4 will replace this with LLM-powered synthesis.
 *
 * This exists so we can restructure the pipeline without breaking scan.
 */
export async function synthesizeEvents(
  interactions: RawInteraction[],
  profile: ProductProfile,
  options: { fast?: boolean; apiKey?: string; granular?: boolean; verbose?: boolean }
): Promise<SynthesizedEvent[]> {
  if (options.fast || !options.apiKey) {
    return regexFallbackSynthesis(interactions, { granular: options.granular });
  }

  return llmSynthesis(interactions, profile, options.apiKey, options.granular, options.verbose);
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
 * Will be replaced by LLM synthesis on Day 4.
 */
function guessEventName(interaction: RawInteraction): string | null {
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

  // Strip "handle"/"on" prefix
  let name = handler.replace(/^handle/, '').replace(/^on/, '');
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

  // Fall back to related entities from the interaction
  if (interaction.relatedEntities?.length) {
    const entity = interaction.relatedEntities[0];
    return `${entity}_interacted`;
  }

  // Final fallback: if we can infer object from file path, use it.
  const fromPath = extractLikelyObjectFromPath(interaction.file);
  if (fromPath) return `${fromPath}_interacted`;

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

function deduplicateEvents(events: SynthesizedEvent[]): SynthesizedEvent[] {
  const byName = new Map<string, SynthesizedEvent>();
  for (const event of events) {
    const key = event.name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, event);
    } else {
      // Keep higher confidence; merge sourceInteractions
      if ((event.location.confidence ?? 0) > (existing.location.confidence ?? 0)) {
        byName.set(key, {
          ...event,
          sourceInteractions: [...new Set([...existing.sourceInteractions, ...event.sourceInteractions])],
        });
      } else {
        existing.sourceInteractions = [...new Set([...existing.sourceInteractions, ...event.sourceInteractions])];
      }
    }
  }
  return Array.from(byName.values());
}

// ─── Legacy LLM helpers (preserved for Day 4) ─────────────────────────────
//
// These functions are not called by the temporary synthesizeEvents stub.
// Day 4 will replace synthesizeEvents with a real LLM call that uses these.

/** Legacy interaction type from the old interaction-scanner.ts */
type LegacyInteractionTypes = {
  actorToObject: Array<{
    actor: 'User' | 'System';
    action: string;
    object: string;
    suggestedEvent: string;
    ambiguous?: boolean;
    rawHandler?: string;
    location?: import('../types').CodeLocation;
    searchPatterns?: string[];
    hint?: string;
  }>;
  actorToActor: Array<any>;
  actorToActorViaObject: Array<any>;
  systemToObject: Array<any>;
};

/** @deprecated Use synthesizeEvents instead. Kept for Day 4 LLM integration. */
export async function normalizeInteractions(args: {
  interactions: LegacyInteractionTypes;
  deep: boolean;
  apiKey?: string;
}): Promise<LegacyInteractionTypes> {
  const out = { ...args.interactions };
  const cleaned: typeof out.actorToObject = [];

  for (const it of out.actorToObject) {
    if (isValidEventName(it.suggestedEvent)) {
      cleaned.push({ ...it, ambiguous: it.ambiguous ?? false });
      continue;
    }

    if (!args.deep || !args.apiKey) continue;

    const renamed = await llmSuggestEventName({
      apiKey: args.apiKey,
      file: it.location?.file,
      hint: it.location?.hint ?? it.hint,
      rawHandler: it.rawHandler,
      context: it.location?.context,
      currentSuggestion: it.suggestedEvent,
    });

    if (renamed && isValidEventName(renamed)) {
      cleaned.push({ ...it, suggestedEvent: renamed, ambiguous: true });
    }
  }

  out.actorToObject = cleaned;
  return out;
}

/** @deprecated Use synthesizeEvents instead. Kept for Day 4 LLM integration. */
export async function llmSuggestEventName(args: {
  apiKey: string;
  file?: string;
  hint?: string;
  rawHandler?: string;
  context?: string;
  currentSuggestion?: string;
}): Promise<string | null> {
  const client = new OpenAI({ apiKey: args.apiKey });
  const prompt = [
    'You are helping generate analytics event names.',
    'Return ONLY JSON: { "eventName": string | null }',
    '',
    'Rules:',
    '- snake_case',
    '- object_verb format (e.g. workflow_created, template_selected)',
    '- avoid garbage patterns like save_saved, click_clicked, update_updated',
    '- if you cannot infer a meaningful object, return null',
    '',
    `File: ${args.file ?? 'unknown'}`,
    `Handler: ${args.rawHandler ?? 'unknown'}`,
    `UI hint: ${args.hint ?? 'none'}`,
    `Current suggestion: ${args.currentSuggestion ?? 'none'}`,
    '',
    'Context snippet:',
    (args.context ?? '').slice(0, 1200),
  ].join('\n');

  try {
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You output strict JSON only.' },
        { role: 'user', content: prompt },
      ],
    });
    const content = resp.choices[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content) as { eventName?: unknown };
    return typeof parsed.eventName === 'string' ? parsed.eventName : null;
  } catch {
    return null;
  }
}

/** @deprecated Use synthesizeEvents instead. Kept for Day 4 LLM integration. */
export async function groupIntoBusinessEvents(
  granularGaps: import('../discovery/tracking-gap-detector').TrackingGap[],
  profile: ProductProfile,
  apiKey: string
): Promise<import('../discovery/tracking-gap-detector').TrackingGap[]> {
  const prompt = `You are a product analytics expert. Given these granular UI interactions, group them into meaningful business events.

Product: ${profile.mission}

Detected interactions:
${granularGaps.map((e) => `- ${e.suggestedEvent} (${e.location?.file ?? 'unknown'}): ${e.reason}`).join('\n')}

Rules:
1. Group related actions into single business events (e.g., add/remove/reorder items → "edited")
2. Keep truly distinct actions separate (e.g., "created" vs "deleted" are different)
3. Name events from the user's perspective, not the code's perspective
4. Use format: object_action (workflow_edited, step_configured, trigger_selected)
5. importance: "high" | "medium" | "low"

Return JSON only:
{
  "events": [
    {
      "name": "workflow_edited",
      "description": "User modified their workflow (added/removed/reordered steps, changed mappings)",
      "includes": ["mapping_added", "mapping_removed", "mapping_changed", "step_config_saved"],
      "locations": ["src/components/workflow/StepConfigPanel.tsx"],
      "importance": "high"
    }
  ]
}`;

  try {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a product analytics expert. Return only valid JSON.' },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });
    const content = response.choices[0]?.message?.content;
    if (!content) return granularGaps;

    const parsed = JSON.parse(content) as {
      events?: Array<{
        name: string;
        description?: string;
        includes?: string[];
        locations?: string[];
        importance?: string;
      }>;
    };
    const events = parsed.events ?? [];
    const gapByName = new Map(granularGaps.map((g) => [g.suggestedEvent.toLowerCase(), g]));

    const result: import('../discovery/tracking-gap-detector').TrackingGap[] = [];
    for (const ev of events) {
      const includes = ev.includes ?? [];
      const locations = ev.locations ?? [];
      let location: CodeLocation = { file: 'unknown', line: 0 };
      for (const inc of includes) {
        const g = gapByName.get(inc.toLowerCase());
        if (g?.location?.file !== 'unknown') { location = g!.location; break; }
      }
      if (location.file === 'unknown' && locations[0]) {
        location = { file: locations[0], line: 0 };
      }
      const priority = (
        ev.importance === 'high' ? 'high' : ev.importance === 'low' ? 'low' : 'medium'
      ) as 'high' | 'medium' | 'low';
      result.push({
        suggestedEvent: ev.name,
        reason: ev.description ?? ev.name,
        location,
        confidence: 0.8,
        priority,
        description: ev.description,
        includes: includes.length > 0 ? includes : undefined,
        locations: locations.length > 0 ? locations : undefined,
      });
    }
    return result.length > 0 ? result : granularGaps;
  } catch {
    return granularGaps;
  }
}
