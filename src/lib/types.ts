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
  interactions: AgentInteraction[];
  feedback: DeveloperFeedback[];
  timestamp: Date;
}

export interface AgentInteraction {
  action: string;
  reasoning: string;
  toolCalls: ToolCall[];
  result: any;
  timestamp: Date;
}

export interface DeveloperFeedback {
  type: 'approve' | 'reject' | 'modify';
  eventSuggestion: EventSuggestion;
  comments?: string;
  timestamp: Date;
}

export interface ToolCall {
  tool: string;
  parameters: Record<string, any>;
  result?: any;
  timestamp: Date;
}

export interface LoggingPattern {
  framework: string;
  importPattern: string;
  callPattern: string;
  examples: string[];
  frequency: number;
}

export interface StylePreferences {
  eventNaming: 'snake_case' | 'camelCase' | 'kebab-case';
  propertyNaming: 'snake_case' | 'camelCase';
  quoteStyle: 'single' | 'double';
  indentStyle: 'spaces' | 'tabs';
  indentSize: number;
}

export interface DomainKnowledge {
  domain: 'saas' | 'ecommerce' | 'fintech' | 'other';
  entities: Entity[];
  commonMetrics: string[];
  thirdPartyTools: string[];
}

export interface EntityState {
  state: string;
  transitions: StateTransition[];
}

export interface StateTransition {
  to: string;
  trigger: string;
}

export interface Entity {
  name: string;
  lifecycle: EntityState[];
  actions: string[];
  properties: EventProperty[];
}

export interface SemanticMemory {
  repoId: string;
  loggingPatterns: LoggingPattern[];
  stylePreferences: StylePreferences;
  domainKnowledge: DomainKnowledge;
  updatedAt: Date;
  productCategory?: string;
  productCategoryConfidence?: number;
  initialEventInventory?: DiscoveredEvent[];
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

export interface DualClassification {
  name: string;
  classification: 'both';
  asActor: {
    type: 'user' | 'system' | 'integration';
    canPerformActions: string[];
    identifierPattern?: string;
  };
  asObject: {
    lifecycleStates: string[];
    belongsTo: string[];
    properties: string[];
  };
  source: 'typescript' | 'prisma' | 'database' | 'inferred';
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

export interface ActorToActorInteraction {
  actor: string;
  action: string;
  targetActor: string;
  suggestedEvent: string;
  location?: CodeLocation;
  confidence?: number;
}

export interface ActorToActorViaObjectInteraction {
  actor: string;
  action: string;
  targetActor: string;
  object: string;
  suggestedEvent: string;
  location?: CodeLocation;
  confidence?: number;
}

export interface SystemToObjectInteraction {
  trigger: string;
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

export interface InteractionTypes {
  actorToObject: ActorToObjectInteraction[];
  actorToActor: ActorToActorInteraction[];
  actorToActorViaObject: ActorToActorViaObjectInteraction[];
  systemToObject: SystemToObjectInteraction[];
  objectToObject: ObjectToObjectRelationship[];
}

// ─── Bulk Actions & Context ───

export interface BulkAction {
  action: string;
  object: string;
  location: CodeLocation;
  loggingRecommendation: 'single_event_with_count' | 'per_object_event';
  suggestedEvent: string;
  confidence?: number;
}

export interface ContextProperty {
  object: string;
  requiredContext: string[];
  reason: string;
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

export interface ActorObjectExtractionResult {
  actors: Actor[];
  objects: TrackedObject[];
  dualClassifications: DualClassification[];
  interactions: InteractionTypes;
  bulkActions: BulkAction[];
  contextProperties: ContextProperty[];
  lifecycles: ObjectLifecycle[];
}

// ─── Tracking Gap Types ───

export type GapType = 'product_analytics' | 'operational';
export type GapCategory =
  | 'failure_recovery'
  | 'unobservable_behavior'
  | 'business_critical'
  | 'state_transition'
  | 'decision_point';
export type GapPriority = 'high' | 'medium' | 'low';

export interface TrackingGapRich {
  action: string;
  entity: string;
  suggestedEvent: string;
  location: CodeLocation;
  reason: string;
  confidence?: number;
  needsReview?: boolean;
  gapType?: GapType;
  category?: GapCategory;
  priority?: GapPriority;
}

// ─── Event Schema Patterns ───

export interface EventSchemaPatterns {
  commonProperties: Array<{ name: string; frequency: number; percentage: number }>;
  propertyPatterns: {
    userIdPattern?: string;
    timestampPattern?: string;
    identifierPatterns: string[];
  };
  namingConvention: 'snake_case' | 'camelCase' | 'kebab-case' | 'mixed';
  averagePropertyCount: number;
}

// ─── Reasoning Types ───

export interface ReasoningStep {
  step: number;
  action: string;
  reasoning: string;
  evidence: string[];
  confidence: number;
}

export interface Plan {
  steps: ReasoningStep[];
  goal: string;
  context: string;
}

// ─── SaaS Domain Types ───

export interface SaaSEvent {
  name: string;
  category: 'activation' | 'engagement' | 'retention' | 'revenue' | 'churn' | 'general';
  required: boolean;
  properties: EventProperty[];
  entity: string;
  metric: string;
  triggerHints?: string[];
}

export interface CodebaseGraphNode {
  id: string;
  type: 'file' | 'function' | 'component' | 'route' | 'entity';
  name: string;
  file?: string;
  relationships: CodebaseGraphEdge[];
  metadata: Record<string, any>;
}

export interface CodebaseGraphEdge {
  target: string;
  type: 'imports' | 'calls' | 'uses' | 'depends_on';
  weight?: number;
}

// ─── Agent Action Types ───

export type AgentAction =
  | { type: 'suggest_events'; events: EventSuggestion[] }
  | { type: 'generate_code'; event: EventSuggestion; code: string }
  | { type: 'request_feedback'; question: string }
  | { type: 'commit_code'; file: string; code: string }
  | { type: 'analyze_diff'; diff: string };

export interface AgentResponse {
  action: AgentAction;
  reasoning: string;
  confidence: number;
  alternatives?: AgentAction[];
}

// ─── Hybrid Event Discovery ───

export interface DiscoveredEvent {
  name: string;
  properties: string[];
  locations: CodeLocation[];
  source: 'codebase' | 'config';
  framework?: string;
  exampleCode?: string;
  importance?: 'core' | 'secondary' | 'utility';
  importanceReason?: string;
}

export interface FeatureGoals {
  functionality?: string;
  businessGoal?: string;
  metrics?: string;
}

export interface ReasoningResult {
  prIntent: string;
  featureGoals?: FeatureGoals;
  reusableEvents: ReusableEvent[];
  affectedEntity: Entity | null;
  matchedPattern: EventPatternMatch | null;
  suggestedEvents: SuggestedEventFromReasoning[];
}

export interface ReusableEvent {
  existingEvent: DiscoveredEvent;
  suggestion: string;
  confidence: number;
}

export interface EventPatternMatch {
  pattern: string;
  event: SaaSEvent;
  confidence: number;
}

export interface SuggestedEventFromReasoning {
  eventName: string;
  properties: EventProperty[];
  rationale: string;
  source: 'reuse' | 'pattern' | 'general';
  entity?: string;
  metric?: string;
  filePath?: string;
  diffLine?: number;
  suggestedCode?: string;
  triggerContext?: string;
}

export interface EventPattern {
  pattern: RegExp | string;
  event: SaaSEvent;
  confidence: number;
}

export interface ICodeIndexer {
  search(query: string, topK?: number): Promise<Array<{
    chunk: { type: string; file: string; code: string; id: string };
    score: number;
  }>>;
  indexFiles(files: Array<{ path: string; content: string }>, codebasePath?: string): Promise<{
    codebasePath: string;
    totalFiles: number;
    totalChunks: number;
    fileChunks: number;
    functionChunks: number;
    indexedAt: string;
    embeddingModel: string;
  }>;
}

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
  includes?: string[];           // grouped granular events
  firstSeen: string;
  lastSeen: string;
}

export interface TrackingPlanContext {
  actors: Actor[];
  objects: TrackedObject[];
  relationships: ObjectToObjectRelationship[];
  lifecycles: ObjectLifecycle[];
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
