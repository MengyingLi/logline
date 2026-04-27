/**
 * logline-cli — Programmatic API
 *
 * Use this to integrate Logline's analysis engine into other tools
 * (GitHub Apps, CI pipelines, editor plugins, etc.)
 */

// Core pipeline stages
export {
  loadCodebaseFiles,
  runInventory,
  analyzeProduct,
  detectInteractions,
  extractContext,
  synthesizeEvents,
  findBestLocation,
  inferEventProperties,
} from './lib/pipeline';

// High-level commands
export { scanCommand, type ScanResult } from './commands/scan';
export { specCommand } from './commands/spec';
export { metricsCommand } from './commands/metrics';
export { contextCommand } from './commands/context';

// Tracking plan utilities
export {
  readTrackingPlan,
  writeTrackingPlan,
  mergeTrackingPlan,
  generateEventId,
  getTrackingPlanPath,
  createEmptyTrackingPlan,
} from './lib/utils/tracking-plan';

// Context extraction
export { extractTrackingPlanContext } from './lib/context/actor-object-extractor';
export { detectLifecycles } from './lib/context/lifecycle-detector';
export { generateMetrics } from './lib/context/metric-generator';
export { generateExpectedSequences } from './lib/context/expected-sequence';

// Code generation
export { generateTrackingCode } from './lib/utils/code-generator';

// Apply command (programmatic / MCP use)
export { applyCommand, applyEvent } from './commands/apply';
export { analyzeScope } from './lib/utils/scope-analyzer';

// Types
export type {
  FileContent, CodeLocation, ProductProfile, DetectedEvent, EventProperty,
  TrackingPlan, TrackingPlanEvent, TrackingPlanContext, TrackingPlanMetric,
  CoverageStats, JoinPath, ExpectedSequence,
  PRContext, EventSuggestion, DeveloperFeedback, EpisodicMemory,
  Actor, TrackedObject, ObjectToObjectRelationship, ObjectLifecycle,
  InteractionTypes, ActorToObjectInteraction,
} from './lib/types';

// Pipeline types
export type {
  RawInteraction, SynthesizedEvent, InventoryResult, InstrumentableEvent,
  PropertySpec, PipelineResult,
} from './lib/pipeline/types';

