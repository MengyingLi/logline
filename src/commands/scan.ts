import chalk from 'chalk';
import * as path from 'path';

import type { DetectedEvent, ProductProfile } from '../lib/types';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';
import type { SynthesizedEvent } from '../lib/pipeline/types';
import type { TrackingPlanContext } from '../lib/types';
import type { ConventionCoverage } from '../conventions';
import { loadConventions, matchConventionsToCodebase, computeConventionCoverage, getConventionsDir } from '../conventions';
import ora from 'ora';

import { loadCodebaseFiles } from '../lib/pipeline/01-load-files';
import { runInventory } from '../lib/pipeline/02-inventory';
import { analyzeProduct } from '../lib/pipeline/03-product-profile';
import { detectInteractions } from '../lib/pipeline/04-detect-interactions';
import { extractContext } from '../lib/pipeline/04b-extract-context';
import { synthesizeEvents } from '../lib/pipeline/05-synthesize-events';
import { findBestLocation } from '../lib/pipeline/06-find-locations';
import { hashCodebase, readCache, writeCache } from '../lib/utils/cache';
import { readLoglineConfig } from '../lib/utils/config';

export interface ScanResult {
  profile: ProductProfile;
  events: DetectedEvent[];
  gaps: TrackingGap[];
  context?: TrackingPlanContext;
  coverage: {
    tracked: number;
    missing: number;
    percentage: number;
  };
  conventionCoverage?: ConventionCoverage[];
}

const SCAN_CACHE_VERSION = 6;

export async function scanCommand(options: {
  fast?: boolean;
  deep?: boolean;
  granular?: boolean;
  verbose?: boolean;
  json?: boolean;
  cwd?: string;
}): Promise<ScanResult> {
  const cwd = options.cwd ?? process.cwd();
  const config = readLoglineConfig(cwd);
  const spinnersEnabled = !options.json;

  const fail = (message: string): never => {
    // Keep errors clean for --json output.
    if (options.json) throw new Error(message);
    console.error(chalk.red(`Error: ${message}`));
    throw new Error(message);
  };

  // Stage 1: Load files
  const loadSpinner = spinnersEnabled ? ora('Loading codebase...').start() : null;
  const files = await loadCodebaseFiles(cwd, {
    include: config.scan.include,
    exclude: config.scan.exclude,
  });
  if (loadSpinner) loadSpinner.succeed(`Found ${files.length} files`);
  if (options.verbose && !options.json) {
    console.log('\n[Loaded files]');
    for (const f of files) console.log(' - ' + f.path);
    console.log();
  }

  const sourceFiles = files.filter((f) => /\.(ts|tsx|js|jsx)$/.test(f.path));
  if (sourceFiles.length === 0) {
    fail('No source files found. Run logline in a directory with .ts/.tsx/.js/.jsx files.');
  }

  // Cache check
  const cachePath = path.join(cwd, '.logline', 'cache', 'scan.json');
  const codebaseHash = hashCodebase(files);
  const optionsKey = `fast=${Boolean(options.fast)};deep=${Boolean(options.deep)};granular=${Boolean(options.granular)};eventGranularity=${config.eventGranularity};include=${config.scan.include.join(',')};exclude=${config.scan.exclude.join(',')}`;
  const cached = readCache<ScanResult>(cachePath);
  if (
    cached &&
    cached.codebaseHash === codebaseHash &&
    cached.version === SCAN_CACHE_VERSION &&
    cached.optionsKey === optionsKey &&
    Array.isArray(cached.result?.gaps) &&
    Array.isArray(cached.result?.events)
  ) {
    return cached.result;
  }

  // Stage 2: Inventory existing analytics
  const inventory = runInventory(files);

  // Stage 3: Product understanding (skip if --fast)
  if (!options.fast && !process.env.OPENAI_API_KEY) {
    fail('Set OPENAI_API_KEY for smart detection, or use --fast for regex-only mode');
  }

  const profileSpinner = spinnersEnabled && !options.fast ? ora('Analyzing product profile...').start() : null;
  const profile: ProductProfile = options.fast
    ? {
        mission: 'Not analyzed (fast mode)',
        valueProposition: 'Not analyzed (fast mode)',
        businessGoals: [],
        userPersonas: [],
        keyMetrics: [],
        confidence: 0,
      }
    : await analyzeProduct({
        apiKey: process.env.OPENAI_API_KEY,
        files,
        existingEventNames: inventory.existingEvents.map((e) => e.name),
        entities: inventory.detectedEntities,
        verbose: Boolean(options.verbose && spinnersEnabled),
      });
  if (profileSpinner) profileSpinner.succeed(`Product analyzed (confidence: ${Math.round(profile.confidence * 100)}%)`);

  // Stage 4: Detect interactions (raw, unnamed)
  const detectSpinner = spinnersEnabled ? ora('Detecting interactions...').start() : null;
  const interactions = detectInteractions(files);
  if (detectSpinner) detectSpinner.succeed(`Found ${interactions.length} interactions`);
  if (options.verbose && !options.json) {
    console.log('\n[Detected interactions]');
    for (const i of interactions) console.log(` - ${i.file}:${i.line} ${i.type} ${i.functionName}`);
    console.log();
  }

  // Stage 04b: Extract context graph (actors/objects/lifecycles)
  const contextSpinner = spinnersEnabled ? ora('Extracting product context...').start() : null;
  const context = extractContext(files);
  if (contextSpinner) contextSpinner.succeed(`Context: ${context.objects.length} objects, ${context.actors.length} actors`);

  // Stage 5: Synthesize events (temporary regex-based; Day 4 adds LLM)
  const synthSpinner = spinnersEnabled ? ora('Synthesizing business events...').start() : null;
  const synthesized = await synthesizeEvents(interactions, profile, {
    fast: options.fast,
    apiKey: process.env.OPENAI_API_KEY,
    granular: options.granular,
    verbose: Boolean(options.verbose && spinnersEnabled),
  });
  if (synthSpinner) synthSpinner.succeed(`${synthesized.length} events identified`);

  // Stage 6: Refine locations for events that don't have a concrete one
  const existingNames = new Set(inventory.existingEvents.map((e) => e.name.toLowerCase()));
  const newEvents = synthesized.filter((e) => !existingNames.has(e.name.toLowerCase()));

  const locSpinner = spinnersEnabled && newEvents.length > 0 ? ora('Refining event locations...').start() : null;
  for (const event of newEvents) {
    if (!event.location || event.location.file === 'unknown' || event.location.line === 0) {
      event.location = await findBestLocation(
        synthesizedToGapLike(event),
        files,
        Boolean(options.deep)
      );
    }
  }
  if (locSpinner) locSpinner.succeed('Locations refined');

  // Convert to ScanResult format (backward compatible with spec/pr)
  const gaps = newEvents.map(synthesizedToGap);

  let result = normalizeScanResult({
    profile,
    events: inventory.existingEvents,
    gaps,
    context,
    coverage: calculateCoverage(inventory.existingEvents, gaps),
  });

  result = await attachConventionCoverage(result, files);
  writeCache(cachePath, { codebaseHash, optionsKey, version: SCAN_CACHE_VERSION, result });
  return result;
}

// ─── Converters ───

function synthesizedToGap(event: SynthesizedEvent): TrackingGap {
  return {
    suggestedEvent: event.name,
    reason: event.description,
    location: event.location,
    confidence: event.location.confidence ?? 0.6,
    priority: event.priority,
    description: event.description,
    includes: event.includes,
    locations: event.allLocations?.map((l) => l.file),
  };
}

function synthesizedToGapLike(event: SynthesizedEvent): TrackingGap {
  return {
    suggestedEvent: event.name,
    reason: event.description,
    location: event.location ?? { file: 'unknown', line: 0 },
    confidence: event.location?.confidence ?? 0.5,
    priority: event.priority,
  };
}

// ─── Helpers ───

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
    context: r.context,
    coverage: r.coverage ?? { tracked: events.length, missing: gaps.length, percentage: 0 },
  };
}

function calculateCoverage(existing: DetectedEvent[], gaps: TrackingGap[]): ScanResult['coverage'] {
  const tracked = existing.length;
  const missing = gaps.length;
  const total = tracked + missing;
  const percentage = total > 0 ? Math.round((tracked / total) * 100) : 0;
  return { tracked, missing, percentage };
}

async function attachConventionCoverage(result: ScanResult, files: import('../lib/types').FileContent[]): Promise<ScanResult> {
  try {
    const dir = getConventionsDir();
    const loaded = await loadConventions(dir);
    if (loaded.byDomain.size === 0) return result;
    const domains = matchConventionsToCodebase(files);
    if (domains.length === 0) return result;
    const conventionCoverage = await computeConventionCoverage(files, result.events, loaded, domains);
    return { ...result, conventionCoverage };
  } catch {
    return result;
  }
}
