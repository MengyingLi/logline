import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import OpenAI from 'openai';

import type { CodeLocation, DetectedEvent, FileContent, ProductProfile } from '../lib/types';
import { BusinessReasoner } from '../lib/analyzers/business-reasoner';
import { InteractionScanner } from '../lib/discovery/interaction-scanner';
import { TrackingGapDetector, type TrackingGap } from '../lib/discovery/tracking-gap-detector';
import { findStatusTransition, inferFileLocation } from '../lib/utils/location-finder';
import { isValidEventName } from '../lib/utils/event-name';

export interface ScanResult {
  profile: ProductProfile;
  events: DetectedEvent[];
  gaps: TrackingGap[];
  coverage: {
    tracked: number;
    missing: number;
    percentage: number;
  };
}

const SCAN_CACHE_VERSION = 3;

interface LoglineConfig {
  eventGranularity?: 'business' | 'granular';
}

function loadLoglineConfig(cwd: string): LoglineConfig {
  const configPath = path.join(cwd, '.logline', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as LoglineConfig;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export async function scanCommand(options: {
  fast?: boolean;
  deep?: boolean;
  granular?: boolean;
  cwd?: string;
}): Promise<ScanResult> {
  const cwd = options.cwd ?? process.cwd();
  const files = await loadCodebaseFiles(cwd);
  const config = loadLoglineConfig(cwd);
  const useBusinessGrouping =
    !options.granular &&
    (config.eventGranularity !== 'granular');

  // Cache
  const cachePath = path.join(cwd, '.logline', 'cache', 'scan.json');
  const codebaseHash = hashCodebase(files);
  const optionsKey = `fast=${Boolean(options.fast)};deep=${Boolean(options.deep)};granular=${Boolean(options.granular)};businessGrouping=${useBusinessGrouping}`;
  const cached = readCache(cachePath);
  if (
    cached &&
    cached.codebaseHash === codebaseHash &&
    cached.version === SCAN_CACHE_VERSION &&
    cached.optionsKey === optionsKey
  ) {
    return cached.result;
  }

  // Step 1: Quick regex scan (always runs)
  const quick = quickRegexScan(files);
  if (options.fast) {
    const profile: ProductProfile = {
      mission: 'Not analyzed (fast mode)',
      valueProposition: 'Not analyzed (fast mode)',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    };

    let gaps = await detectAndRefineGaps({ files, existingEvents: quick.events, profile: undefined, deep: false });
    if (useBusinessGrouping && process.env.OPENAI_API_KEY) {
      gaps = await groupIntoBusinessEvents(gaps, profile, process.env.OPENAI_API_KEY);
    }
    const result: ScanResult = normalizeScanResult({
      profile,
      events: quick.events,
      gaps,
      coverage: calculateCoverage(quick.events, gaps),
    });

    writeCache(cachePath, { codebaseHash, optionsKey, version: SCAN_CACHE_VERSION, result });
    return result;
  }

  // Step 2: Product understanding (LLM)
  const apiKey = process.env.OPENAI_API_KEY;
  const profile = await analyzeProduct({
    apiKey,
    files,
    existingEventNames: quick.events.map((e) => e.name),
    entities: quick.entities,
  });

  // Step 3-6: Interactions -> gaps -> refine -> prioritize
  let gaps = await detectAndRefineGaps({
    files,
    existingEvents: quick.events,
    profile,
    deep: Boolean(options.deep),
  });

  // Pass 2: Group granular events into business events (when not --granular)
  if (useBusinessGrouping && apiKey && gaps.length > 0) {
    gaps = await groupIntoBusinessEvents(gaps, profile, apiKey);
  }

  const result: ScanResult = normalizeScanResult({
    profile,
    events: quick.events,
    gaps,
    coverage: calculateCoverage(quick.events, gaps),
  });

  writeCache(cachePath, { codebaseHash, optionsKey, version: SCAN_CACHE_VERSION, result });
  return result;
}

/** Ensure result always has arrays for gaps and events (never fallback or wrong shape). */
function normalizeScanResult(r: Partial<ScanResult>): ScanResult {
  const gaps = Array.isArray(r.gaps) ? r.gaps : [];
  const events = Array.isArray(r.events) ? r.events : [];
  return {
    profile: r.profile ?? {
      mission: 'Not analyzed',
      valueProposition: '',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    },
    events,
    gaps,
    coverage: r.coverage ?? { tracked: events.length, missing: gaps.length, percentage: 0 },
  };
}

async function groupIntoBusinessEvents(
  granularGaps: TrackingGap[],
  profile: ProductProfile,
  apiKey: string
): Promise<TrackingGap[]> {
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
    const parsed = JSON.parse(content) as { events?: Array<{
      name: string;
      description?: string;
      includes?: string[];
      locations?: string[];
      importance?: string;
    }> };
    const events = parsed.events ?? [];
    const gapByName = new Map<string, TrackingGap>(granularGaps.map((g) => [g.suggestedEvent.toLowerCase(), g]));

    const result: TrackingGap[] = [];
    for (const ev of events) {
      const includes = ev.includes ?? [];
      const locations = ev.locations ?? [];
      const primaryFile = locations[0];
      let location: CodeLocation = { file: 'unknown', line: 0 };
      for (const inc of includes) {
        const g = gapByName.get(inc.toLowerCase());
        if (g?.location?.file !== 'unknown') {
          location = g!.location;
          break;
        }
      }
      if (location.file === 'unknown' && primaryFile) {
        location = { file: primaryFile, line: 0 };
      }
      const priority = (ev.importance === 'high' ? 'high' : ev.importance === 'low' ? 'low' : 'medium') as TrackingGap['priority'];
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

async function analyzeProduct(args: {
  apiKey: string | undefined;
  files: FileContent[];
  existingEventNames: string[];
  entities: string[];
}): Promise<ProductProfile> {
  if (!args.apiKey) {
    return {
      mission: 'Not analyzed (OPENAI_API_KEY not set)',
      valueProposition: 'Not analyzed (OPENAI_API_KEY not set)',
      businessGoals: [],
      userPersonas: [],
      keyMetrics: [],
      confidence: 0,
    };
  }

  const reasoner = new BusinessReasoner({ apiKey: args.apiKey });
  const codebaseSummary = reasoner.generateCodebaseSummary(args.files, args.entities.map((e) => ({ name: e })));

  return await reasoner.analyzeProduct({
    codebaseSummary,
    existingEvents: args.existingEventNames,
    entities: args.entities,
  });
}

async function detectAndRefineGaps(args: {
  files: FileContent[];
  existingEvents: DetectedEvent[];
  profile?: ProductProfile;
  deep: boolean;
}): Promise<TrackingGap[]> {
  // Interaction scanning
  const interactionScanner = new InteractionScanner();
  const interactions = await interactionScanner.scan(args.files);

  // Drop garbage / unresolved names; try LLM rename when deep
  const apiKey = process.env.OPENAI_API_KEY;
  const normalized = await normalizeInteractions({
    interactions,
    deep: args.deep,
    apiKey,
  });

  // Gap detection
  const gapDetector = new TrackingGapDetector();
  const gaps = gapDetector.detectGapsFromInteractions({
    interactions: normalized,
    existingEventNames: args.existingEvents.map((e) => e.name),
    profile: args.profile,
  });

  // Location refinement
  for (const gap of gaps) {
    if (!gap.location || gap.location.file === 'unknown' || gap.location.line === 0) {
      gap.location = await findBestLocation(gap, args.files, args.deep);
    }
  }

  return gaps;
}

async function normalizeInteractions(args: {
  interactions: Awaited<ReturnType<InteractionScanner['scan']>>;
  deep: boolean;
  apiKey?: string;
}): Promise<Awaited<ReturnType<InteractionScanner['scan']>>> {
  const out = { ...args.interactions };
  const cleaned: typeof out.actorToObject = [];

  for (const it of out.actorToObject) {
    if (isValidEventName(it.suggestedEvent)) {
      cleaned.push({ ...it, ambiguous: it.ambiguous ?? false });
      continue;
    }

    // If invalid and not deep, just skip it
    if (!args.deep || !args.apiKey) {
      continue;
    }

    // Deep mode: ask LLM for a better name
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
    // else: skip
  }

  out.actorToObject = cleaned;
  return out;
}

async function llmSuggestEventName(args: {
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

async function findBestLocation(gap: TrackingGap, files: FileContent[], deep: boolean): Promise<CodeLocation> {
  // Strategy 1: Status transitions (lifecycle suffixes)
  const m = gap.suggestedEvent.match(/_(started|completed|failed|accepted|rejected)$/);
  if (m) {
    const statusValue = m[1];
    const entityName = gap.suggestedEvent.replace(/_\w+$/, '');
    const matches = findStatusTransition(files, statusValue, entityName);
    if (matches.length > 0) {
      const best = matches[0];
      return { file: best.file, line: best.line, context: best.context, confidence: best.confidence, hint: 'status_transition' };
    }
  }

  // Strategy 2: Search patterns from gap
  if (gap.searchPatterns?.length) {
    for (const pattern of gap.searchPatterns) {
      const loc = firstMatchLocation(files, pattern);
      if (loc) return loc;
    }
  }

  // Strategy 3: Infer from event name
  const inferred = inferFileLocation(gap.suggestedEvent, files);
  if (inferred) return { file: inferred.file, line: inferred.line, confidence: inferred.confidence, hint: 'inferred' };

  // Strategy 4: LLM suggestion (placeholder, only when deep)
  if (deep) {
    // Not implemented here (would require a second LLM prompt scoped to files + gap)
  }

  return { file: 'unknown', line: 0, confidence: 0.1, hint: 'unknown' };
}

function firstMatchLocation(files: FileContent[], needle: string): CodeLocation | null {
  for (const file of files) {
    const idx = file.content.indexOf(needle);
    if (idx === -1) continue;
    const lines = file.content.split('\n');
    const line = file.content.substring(0, idx).split('\n').length; // 1-indexed
    const start = Math.max(0, line - 3);
    const end = Math.min(lines.length, line + 2);
    return { file: file.path, line, context: lines.slice(start, end).join('\n'), confidence: 0.5, hint: `match:${needle}` };
  }
  return null;
}

function quickRegexScan(files: FileContent[]): { events: DetectedEvent[]; entities: string[] } {
  const patterns = [
    { framework: 'segment', regex: /analytics\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
    { framework: 'segment', regex: /segment\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
    { framework: 'posthog', regex: /posthog\.capture\s*\(\s*['"`]([^'"`]+)['"`]/g },
    { framework: 'mixpanel', regex: /mixpanel\.track\s*\(\s*['"`]([^'"`]+)['"`]/g },
    { framework: 'custom', regex: /\btrack\s*\(\s*['"`]([^'"`]+)['"`]/g },
  ];

  const byName = new Map<string, DetectedEvent>();
  const entities = new Set<string>();

  for (const file of files) {
    const lines = file.content.split('\n');
    for (const p of patterns) {
      let m: RegExpExecArray | null;
      const rx = new RegExp(p.regex.source, p.regex.flags);
      while ((m = rx.exec(file.content)) !== null) {
        const name = m[1];
        const line = file.content.substring(0, m.index).split('\n').length;
        const start = Math.max(0, line - 3);
        const end = Math.min(lines.length, line + 2);
        const loc: CodeLocation = { file: file.path, line, context: lines.slice(start, end).join('\n'), confidence: 1 };

        const key = name.toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          existing.locations.push(loc);
        } else {
          byName.set(key, { name, framework: p.framework, locations: [loc] });
        }

        // entity heuristic (prefix before _)
        const ent = name.split('_')[0];
        if (ent && ent.length >= 3) entities.add(ent);
      }
    }
  }

  return { events: Array.from(byName.values()), entities: Array.from(entities) };
}

async function loadCodebaseFiles(rootDir: string): Promise<FileContent[]> {
  const patterns = ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.md', '**/package.json'];
  const ignore = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'];

  const fileSet = new Set<string>();
  for (const pat of patterns) {
    const matches = await glob(pat, { cwd: rootDir, ignore, absolute: true });
    for (const m of matches) fileSet.add(m);
  }

  const files: FileContent[] = [];
  for (const abs of fileSet) {
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      files.push({ path: path.relative(rootDir, abs), content });
    } catch {
      // ignore
    }
  }
  return files;
}

function calculateCoverage(existing: DetectedEvent[], gaps: TrackingGap[]): ScanResult['coverage'] {
  const tracked = existing.length;
  const missing = gaps.length;
  const total = tracked + missing;
  const percentage = total > 0 ? Math.round((tracked / total) * 100) : 0;
  return { tracked, missing, percentage };
}

function hashCodebase(files: FileContent[]): string {
  const h = crypto.createHash('sha256');
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  for (const f of sorted) {
    h.update(f.path);
    h.update('\0');
    h.update(String(f.content.length));
    h.update('\0');
    // keep it fast: sample first 2kb
    h.update(f.content.slice(0, 2048));
    h.update('\0');
  }
  return h.digest('hex');
}

function readCache(
  cachePath: string
): { codebaseHash: string; optionsKey: string; version: number; result: ScanResult } | null {
  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      codebaseHash: string;
      optionsKey: string;
      version: number;
      result: ScanResult;
    };
    if (!parsed?.codebaseHash || !parsed?.result || typeof parsed.version !== 'number' || !parsed.optionsKey) {
      return null;
    }
    // Ensure cached result has real scan data (arrays), not placeholder or wrong shape
    const r = parsed.result;
    if (!Array.isArray(r.gaps) || !Array.isArray(r.events)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(
  cachePath: string,
  payload: { codebaseHash: string; optionsKey: string; version: number; result: ScanResult }
): void {
  const dir = path.dirname(cachePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    cachePath,
    JSON.stringify(
      {
        version: payload.version,
        optionsKey: payload.optionsKey,
        codebaseHash: payload.codebaseHash,
        timestamp: new Date().toISOString(),
        result: payload.result,
      },
      null,
      2
    ),
    'utf-8'
  );
}

