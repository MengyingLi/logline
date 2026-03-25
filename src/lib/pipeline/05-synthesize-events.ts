import OpenAI from 'openai';
import type { ProductProfile, CodeLocation } from '../types';
import type { RawInteraction, SynthesizedEvent } from './types';
import { isValidEventName, isBusinessEvent, toSnakeCaseFromPascalOrCamel } from '../utils/event-name';

/**
 * TEMPORARY: Convert raw interactions into events using regex-based naming.
 * Day 4 will replace this with LLM-powered synthesis.
 *
 * This exists so we can restructure the pipeline without breaking scan.
 */
export async function synthesizeEvents(
  interactions: RawInteraction[],
  profile: ProductProfile,
  options: { fast?: boolean; apiKey?: string }
): Promise<SynthesizedEvent[]> {
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
      priority: 'medium',
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

  return deduplicateEvents(events);
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

  const handler = interaction.functionName;

  // Strip "handle"/"on" prefix
  let name = handler.replace(/^handle/, '').replace(/^on/, '');
  if (!name) return null;

  // VerbObject: CreateWorkflow → workflow_created
  const verbObjectMatch = name.match(
    /^(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable)(.+)$/i
  );
  if (verbObjectMatch) {
    const verb = verbObjectMatch[1].toLowerCase();
    const object = toSnakeCaseFromPascalOrCamel(verbObjectMatch[2]);
    const pastVerb = toPastTense(verb);
    return `${object}_${pastVerb}`;
  }

  // ObjectVerb: MappingChange → mapping_changed
  const objectVerbMatch = name.match(
    /^(.*?)(Create|Delete|Update|Add|Remove|Save|Submit|Start|Stop|Test|Select|Toggle|Enable|Disable|Change)$/i
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

  return null;
}

function guessRouteEventName(interaction: RawInteraction): string | null {
  const match = interaction.functionName.match(/^(GET|POST|PUT|PATCH|DELETE)\s+\/([^/\s]+)/i);
  if (!match) return null;

  const method = match[1].toUpperCase();
  const resource = match[2].replace(/-/g, '_').replace(/s$/, '');

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
  };
  return map[verb.toLowerCase()] ?? `${verb.toLowerCase()}ed`;
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
          sourceInteractions: [...existing.sourceInteractions, ...event.sourceInteractions],
        });
      } else {
        existing.sourceInteractions.push(...event.sourceInteractions);
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
