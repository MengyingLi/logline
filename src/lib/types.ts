/**
 * Single source of truth for all Logline types.
 */

// ─── Core Primitives ───

export interface FileContent {
  path: string;
  content: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
  context?: string;
  confidence?: number;
  hint?: string;
}

export interface ProductProfile {
  mission: string;
  valueProposition: string;
  businessGoals: string[];
  userPersonas: string[];
  keyMetrics: string[];
  confidence: number; // 0-1
}

export interface DetectedEvent {
  name: string;
  locations: CodeLocation[];
  properties?: string[];
  framework?: string;
}

// ─── PR Context ───

export interface PRContext {
  prNumber: number;
  repo: string;
  owner: string;
  branch: string;
  baseBranch: string;
  diff: string;
  filesChanged: string[];
  author: string;
}

// ─── Event Types ───

export interface EventProperty {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object';
  required: boolean;
  description?: string;
  /** True when this property came from the context graph and couldn't be verified in scope */
  todo?: boolean;
}

export interface EventSuggestion {
  eventName: string;
  properties: EventProperty[];
  rationale: string;
  codeLocation: CodeLocation;
  priority: 'high' | 'medium' | 'low';
  entity?: string;
  metric?: string;
  diffLine?: number;
  filePath?: string;
  suggestedCode?: string;
  triggerContext?: string;
}

// ─── Memory Types ───

export interface EpisodicMemory {
  prContext: PRContext;
  feedback: DeveloperFeedback[];
  timestamp: Date;
}

export interface DeveloperFeedback {
  type: 'approve' | 'reject' | 'modify';
  eventSuggestion: EventSuggestion;
  comments?: string;
  timestamp: Date;
}

// ─── Actor / Object Classification ───

export interface Actor {
  name: string;
  type: 'user' | 'system' | 'integration';
  source: 'typescript' | 'prisma' | 'database' | 'inferred';
  identifierPattern: string;
  canPerformActions: string[];
  detectedFrom: string;
  confidence?: number;
  needsReview?: boolean;
}

export interface TrackedObject {
  name: string;
  source: 'typescript' | 'prisma' | 'database' | 'inferred';
  properties: string[];
  belongsTo: string[];
  lifecycleStates?: string[];
  exposedViaAPI: boolean;
  confidence?: number;
  needsReview?: boolean;
}

// ─── Interaction Types ───

export interface ActorToObjectInteraction {
  actor: string;
  action: string;
  object: string;
  suggestedEvent: string;
  location?: CodeLocation;
  confidence?: number;
}

export interface ObjectToObjectRelationship {
  parent: string;
  child: string;
  relationship: string;
  contextImplication: string;
}

export interface JoinPath {
  from: string;
  to: string;
  via: string[];
}

export interface ExpectedSequence {
  name: string;
  steps: string[];
  expectedWindow: string;
  significance?: string;
}

export interface InteractionTypes {
  actorToObject: ActorToObjectInteraction[];
  objectToObject: ObjectToObjectRelationship[];
}

// ─── Lifecycle ───

export interface LifecycleStateTransition {
  from: string;
  to: string;
  suggestedEvent: string;
}

export interface ObjectLifecycle {
  object: string;
  states: string[];
  transitions: LifecycleStateTransition[];
}

// ─── Signal Types ───

/**
 * Routes a signal to the right destination and code generation template.
 * - action       → track()          → analytics (Segment, PostHog)
 * - operation    → logger.info()    → logging (Datadog, Grafana)
 * - state_change → BOTH             → analytics + logging
 * - error        → logger.error()   → logging + alerts
 */
export type SignalType = 'action' | 'operation' | 'state_change' | 'error';

// ─── Tracking Plan Format ───

export interface TrackingPlan {
  version: string;
  generatedAt: string;
  generatedBy: string;
  product: ProductProfile;
  events: TrackingPlanEvent[];
  context?: TrackingPlanContext;
  metrics?: TrackingPlanMetric[];
  coverage: CoverageStats;
}

export interface TrackingPlanEvent {
  id: string;                    // stable ID: "evt_<hash of name>"
  name: string;                  // "workflow_edited"
  description: string;
  actor: string;                 // "User"
  object: string;                // "Workflow"
  action: string;                // "edited"
  properties: EventProperty[];
  locations: CodeLocation[];
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'suggested' | 'approved' | 'implemented' | 'deprecated';
  signalType: SignalType;        // routes to track() vs logger.info/error()
  includes?: string[];           // grouped granular events
  firstSeen: string;
  lastSeen: string;
}

export interface TrackingPlanContext {
  actors: Actor[];
  objects: TrackedObject[];
  relationships: ObjectToObjectRelationship[];
  lifecycles: ObjectLifecycle[];
  joinPaths?: JoinPath[];
  expectedSequences?: ExpectedSequence[];
}

export interface TrackingPlanMetric {
  id: string;
  name: string;
  description: string;
  formula: string;
  events: string[];              // event names this metric depends on
  category: 'acquisition' | 'activation' | 'engagement' | 'retention' | 'revenue' | 'referral';
  grain: 'realtime' | 'hourly' | 'daily' | 'weekly' | 'monthly';
  status: 'suggested' | 'approved' | 'implemented';
}

export interface CoverageStats {
  tracked: number;
  suggested: number;
  approved: number;
  implemented: number;
  percentage: number;
}
