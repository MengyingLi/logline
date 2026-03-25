import type { FileContent, CodeLocation, ProductProfile, DetectedEvent } from '../types';
import type { TrackingGap } from '../discovery/tracking-gap-detector';

/** Output of stage 02: inventory of existing analytics */
export interface InventoryResult {
  existingEvents: DetectedEvent[];
  detectedEntities: string[];
  detectedFramework: string | null; // 'segment' | 'posthog' | 'mixpanel' | 'custom' | null
}

/** A raw interaction found in code — NO event name assigned yet */
export interface RawInteraction {
  /** What kind of code pattern this is */
  type: 'click_handler' | 'form_submit' | 'route_handler' | 'mutation' | 'lifecycle' | 'state_change' | 'toggle';
  /** File where the interaction was found */
  file: string;
  /** Line number (1-indexed) */
  line: number;
  /** Name of the function/handler as written in code */
  functionName: string;
  /** ~20 lines of code around the interaction */
  codeContext: string;
  /** UI hint if available (button label, form name, aria-label) */
  uiHint?: string;
  /** Entity names detected from variable names, types, file path */
  relatedEntities?: string[];
  /** The raw expression that triggered detection (e.g., "onClick={handleAddMapping}") */
  triggerExpression?: string;
  /** Confidence that this is a real user interaction worth tracking (0-1) */
  confidence: number;
}

/** Output of stage 04: detected interactions */
export interface DetectionResult {
  interactions: RawInteraction[];
}

/** Output of stage 05: LLM-synthesized events */
export interface SynthesizedEvent {
  name: string;                  // "workflow_edited"
  description: string;           // "User modified their workflow"
  priority: 'critical' | 'high' | 'medium' | 'low';
  /** Which raw interactions this event covers (indices into DetectionResult.interactions) */
  sourceInteractions: number[];
  /** If this groups multiple interactions, what granular actions are included */
  includes?: string[];
  /** Best location to insert tracking code */
  location: CodeLocation;
  /** All locations where this event could be tracked */
  allLocations?: CodeLocation[];
}

/** Output of stage 06: events with refined locations */
export interface LocatedEvent extends SynthesizedEvent {
  /** Exact insertion point (may differ from location if we found a better spot) */
  insertionPoint: CodeLocation;
}

/** Output of stage 07: events with properties */
export interface PropertySpec {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required: boolean;
  description?: string;
  /** How to access this property in code (e.g., "workflow.id", "user?.id") */
  accessPath?: string;
  /** Whether we verified this variable exists in scope */
  verified: boolean;
}

export interface InstrumentableEvent extends LocatedEvent {
  properties: PropertySpec[];
}

/** Full pipeline result */
export interface PipelineResult {
  files: FileContent[];
  inventory: InventoryResult;
  profile: ProductProfile;
  interactions: RawInteraction[];
  events: SynthesizedEvent[];
  instrumentableEvents: InstrumentableEvent[];
}
