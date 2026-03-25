import * as fs from 'fs';
import * as path from 'path';

import type { DetectedEvent, ProductProfile } from '../lib/types';
import type { TrackingGap } from '../lib/discovery/tracking-gap-detector';
import type { SynthesizedEvent } from '../lib/pipeline/types';
import type { ConventionCoverage } from '../conventions';
import { loadConventions, matchConventionsToCodebase, computeConventionCoverage, getConventionsDir } from '../conventions';

import { loadCodebaseFiles } from '../lib/pipeline/01-load-files';
import { runInventory } from '../lib/pipeline/02-inventory';
import { analyzeProduct } from '../lib/pipeline/03-product-profile';
import { detectInteractions } from '../lib/pipeline/04-detect-interactions';
import { synthesizeEvents } from '../lib/pipeline/05-synthesize-events';
import { findBestLocation } from '../lib/pipeline/06-find-locations';
import { hashCodebase, readCache, writeCache } from '../lib/utils/cache';

export interface ScanResult {
  profile: ProductProfile;
  events: DetectedEvent[];
  gaps: TrackingGap[];
  coverage: {
    tracked: number;
    missing: number;
    percentage: number;
  };
  conventionCoverage?: ConventionCoverage[];
}

const SCAN_CACHE_VERSION = 4;

interface LoglineConfig {
  eventGranularity?: 'business' | 'granular';
}

function loadLoglineConfig(cwd: string): LoglineConfig {
  const configPath = path.join(cwd, '.logline', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return (JSON.parse(raw) as LoglineConfig) ?? {};
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
  const config = loadLoglineConfig(cwd);
  const useBusinessGrouping = !options.granular && config.eventGranularity !== 'granular';

  // Stage 1: Load files
  const files = await loadCodebaseFiles(cwd);

  // Cache check
  const cachePath = path.join(cwd, '.logline', 'cache', 'scan.json');
  const codebaseHash = hashCodebase(files);
  const optionsKey = `fast=${Boolean(options.fast)};deep=${Boolean(options.deep)};granular=${Boolean(options.granular)};businessGrouping=${useBusinessGrouping}`;
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
      });

  // Stage 4: Detect interactions (raw, unnamed)
  const interactions = detectInteractions(files);

  // Stage 5: Synthesize events (temporary regex-based; Day 4 adds LLM)
  const synthesized = await synthesizeEvents(interactions, profile, {
    fast: options.fast,
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Stage 6: Refine locations for events that don't have a concrete one
  const existingNames = new Set(inventory.existingEvents.map((e) => e.name.toLowerCase()));
  const newEvents = synthesized.filter((e) => !existingNames.has(e.name.toLowerCase()));

  for (const event of newEvents) {
    if (!event.location || event.location.file === 'unknown' || event.location.line === 0) {
      event.location = await findBestLocation(
        synthesizedToGapLike(event),
        files,
        Boolean(options.deep)
      );
    }
  }

  // Convert to ScanResult format (backward compatible with spec/pr)
  const gaps = newEvents.map(synthesizedToGap);

  let result = normalizeScanResult({
    profile,
    events: inventory.existingEvents,
    gaps,
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
