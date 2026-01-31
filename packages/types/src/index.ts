/**
 * Shared types for Logline platform
 */

export * from './constants';

// PR Context Types
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

// Event Suggestion Types
export interface EventSuggestion {
  eventName: string;
  properties: EventProperty[];
  rationale: string; // Explicit reasoning for this suggestion
  codeLocation: CodeLocation;
  priority: 'high' | 'medium' | 'low';
  entity?: string; // Related entity (User, Order, etc.)
  metric?: string; // Which metric this enables
  
  // Line-level suggestion metadata
  diffLine?: number; // Line number in the diff where the trigger occurs (from + lines)
  filePath?: string; // Full path to the file where suggestion should be added
  suggestedCode?: string; // Complete code snippet ready to insert
  triggerContext?: string; // Code context around the trigger point
}

export interface EventProperty {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object';
  required: boolean;
  description?: string;
}

export interface CodeLocation {
  file: string;
  line: number;
  column?: number;
  function?: string;
  context?: string; // Surrounding code context
}

// Memory Types
export interface EpisodicMemory {
  prContext: PRContext;
  interactions: AgentInteraction[];
  feedback: DeveloperFeedback[];
  timestamp: Date;
}

export interface AgentInteraction {
  action: string;
  reasoning: string; // Explicit rationale
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

export interface SemanticMemory {
  repoId: string;
  loggingPatterns: LoggingPattern[];
  stylePreferences: StylePreferences;
  domainKnowledge: DomainKnowledge;
  updatedAt: Date;
  
  // Product category and event inventory
  productCategory?: string;
  productCategoryConfidence?: number;
  initialEventInventory?: DiscoveredEvent[];
}

export interface LoggingPattern {
  framework: string; // 'segment', 'mixpanel', 'amplitude', etc.
  importPattern: string;
  callPattern: string; // How they call analytics.track()
  examples: string[]; // Code examples
  frequency: number; // How often used in codebase
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

export interface Entity {
  name: string;
  lifecycle: EntityState[];
  actions: string[];
  properties: EventProperty[];
}

// Actor/Object Classification Types
// Actors are entities that perform actions (users, system jobs, integrations)
export interface Actor {
  name: string; // e.g., "User", "CronJob", "StripeWebhook"
  type: 'user' | 'system' | 'integration';
  source: 'typescript' | 'prisma' | 'database' | 'inferred';
  identifierPattern: string; // e.g., "user_id", "org_id"
  canPerformActions: string[]; // e.g., ["create", "invite", "assign"]
  detectedFrom: string; // e.g., "auth middleware", "webhook handler", "session"
  confidence?: number; // 0-1 confidence in extraction
  needsReview?: boolean; // Flag for low confidence
}

// Objects are entities that are acted upon (tasks, projects, etc.)
export interface TrackedObject {
  name: string; // e.g., "Task", "Project", "Evaluation", "Dataset"
  source: 'typescript' | 'prisma' | 'database' | 'inferred';
  properties: string[]; // Key properties/fields
  belongsTo: string[]; // Parent objects (e.g., Task belongsTo Project)
  lifecycleStates?: string[]; // e.g., ["draft", "active", "completed", "archived"]
  exposedViaAPI: boolean; // Has API routes for CRUD?
  confidence?: number; // 0-1 confidence in extraction
  needsReview?: boolean; // Flag for low confidence
}

// Some entities (like Organization, Team) can be both Actor and Object
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

// Interaction Types - Models relationships between actors and objects
export interface ActorToObjectInteraction {
  actor: string; // e.g., "User"
  action: string; // e.g., "create", "update", "delete", "complete"
  object: string; // e.g., "Task", "Project"
  suggestedEvent: string; // e.g., "task_created"
  location?: CodeLocation;
  confidence?: number;
}

export interface ActorToActorInteraction {
  actor: string; // e.g., "User"
  action: string; // e.g., "invite", "mention", "assign"
  targetActor: string; // e.g., "User", "Team"
  suggestedEvent: string; // e.g., "user_invited"
  location?: CodeLocation;
  confidence?: number;
}

export interface ActorToActorViaObjectInteraction {
  actor: string; // e.g., "User"
  action: string; // e.g., "assign", "share", "comment"
  targetActor: string; // e.g., "User"
  object: string; // e.g., "Task"
  suggestedEvent: string; // e.g., "task_assigned" (with assignee_id property)
  location?: CodeLocation;
  confidence?: number;
}

export interface SystemToObjectInteraction {
  trigger: string; // e.g., "cron", "webhook", "automation"
  action: string; // e.g., "archive", "sync", "expire"
  object: string; // e.g., "Task", "Subscription"
  suggestedEvent: string; // e.g., "task_auto_archived"
  location?: CodeLocation;
  confidence?: number;
}

export interface ObjectToObjectRelationship {
  parent: string; // e.g., "Project"
  child: string; // e.g., "Task"
  relationship: string; // e.g., "contains", "produces", "uses"
  contextImplication: string; // e.g., "Include project_id when logging task events"
}

// Container for all interaction types
export interface InteractionTypes {
  actorToObject: ActorToObjectInteraction[];
  actorToActor: ActorToActorInteraction[];
  actorToActorViaObject: ActorToActorViaObjectInteraction[];
  systemToObject: SystemToObjectInteraction[];
  objectToObject: ObjectToObjectRelationship[];
}

// Bulk Action Detection
export interface BulkAction {
  action: string; // e.g., "bulkDelete", "batchInvite"
  object: string; // e.g., "Task", "User"
  location: CodeLocation;
  loggingRecommendation: 'single_event_with_count' | 'per_object_event';
  suggestedEvent: string; // e.g., "tasks_bulk_deleted" or "task_deleted" per item
  confidence?: number;
}

// Context Property Inference
export interface ContextProperty {
  object: string; // e.g., "Task"
  requiredContext: string[]; // e.g., ["project_id", "organization_id"]
  reason: string; // e.g., "Task belongs to Project which belongs to Organization"
}

// Lifecycle State Detection
export interface LifecycleStateTransition {
  from: string;
  to: string;
  suggestedEvent: string; // e.g., "task_completed" for active → completed
}

export interface ObjectLifecycle {
  object: string;
  states: string[]; // e.g., ["draft", "active", "completed", "archived"]
  transitions: LifecycleStateTransition[];
}

// Combined extraction result
export interface ActorObjectExtractionResult {
  actors: Actor[];
  objects: TrackedObject[];
  dualClassifications: DualClassification[];
  interactions: InteractionTypes;
  bulkActions: BulkAction[];
  contextProperties: ContextProperty[];
  lifecycles: ObjectLifecycle[];
}

// Tracking Gap Types
export type GapType = 'product_analytics' | 'operational';
export type GapCategory = 
  | 'failure_recovery'        // Errors, retries, degraded behavior
  | 'unobservable_behavior'   // Background jobs, side effects
  | 'business_critical'       // Data integrity, payments, access
  | 'state_transition'        // Lifecycle changes
  | 'decision_point';         // Why something happened

export type GapPriority = 'high' | 'medium' | 'low';

export interface TrackingGap {
  action: string; // e.g., "completeEvaluation"
  entity: string; // e.g., "Evaluation"
  suggestedEvent: string; // e.g., "evaluation_completed" (following their style)
  location: CodeLocation; // Where the action happens
  reason: string; // Why this should be tracked
  confidence?: number; // 0-1 confidence
  needsReview?: boolean; // Flag for low confidence
  gapType?: GapType; // 'product_analytics' or 'operational' (defaults to 'product_analytics')
  category?: GapCategory; // Type of gap based on code patterns (defaults to 'state_transition')
  priority?: GapPriority; // Priority level for tracking (defaults to 'medium')
}

// Event Schema Patterns (stored in config)
export interface EventSchemaPatterns {
  commonProperties: Array<{ name: string; frequency: number; percentage: number }>;
  propertyPatterns: {
    userIdPattern?: string; // e.g., 'user_id', 'userId', 'user.id'
    timestampPattern?: string; // e.g., 'timestamp', 'created_at', 'time'
    identifierPatterns: string[]; // Common ID patterns (workspace_id, project_id, etc.)
  };
  namingConvention: 'snake_case' | 'camelCase' | 'kebab-case' | 'mixed';
  averagePropertyCount: number;
}

export interface EntityState {
  state: string;
  transitions: StateTransition[];
}

export interface StateTransition {
  to: string;
  trigger: string; // What event triggers this transition
}

// Reasoning Types
export interface ReasoningStep {
  step: number;
  action: string;
  reasoning: string;
  evidence: string[];
  confidence: number; // 0-1
}

export interface Plan {
  steps: ReasoningStep[];
  goal: string;
  context: string;
}

// SaaS Domain Types
export interface SaaSEvent {
  name: string;
  category: 'activation' | 'engagement' | 'retention' | 'revenue' | 'churn' | 'general';
  required: boolean;
  properties: EventProperty[];
  entity: string;
  metric: string;
  triggerHints?: string[]; // Code patterns that suggest this event (e.g., "look for payment success handlers")
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

// Agent Action Types
export type AgentAction =
  | { type: 'suggest_events'; events: EventSuggestion[] }
  | { type: 'generate_code'; event: EventSuggestion; code: string }
  | { type: 'request_feedback'; question: string }
  | { type: 'commit_code'; file: string; code: string }
  | { type: 'analyze_diff'; diff: string };

export interface AgentResponse {
  action: AgentAction;
  reasoning: string; // Always explicit
  confidence: number;
  alternatives?: AgentAction[]; // Other options considered
}

// Hybrid Event Suggestion Types
export interface DiscoveredEvent {
  name: string;
  properties: string[];
  locations: CodeLocation[];
  source: 'codebase' | 'config';
  framework?: string; // Framework used (segment, posthog, etc.)
  exampleCode?: string; // Example of how it's called
  importance?: 'core' | 'secondary' | 'utility'; // Importance based on API routes, entity relationships
  importanceReason?: string; // e.g., "Called from API route /api/projects/create"
}

export interface FeatureGoals {
  functionality?: string; // What core functionality/actions need to be tracked
  businessGoal?: string; // What business goal does this serve (engagement, collaboration, retention, etc.)
  metrics?: string; // What metrics would help understand if the goal is met
}

export interface ReasoningResult {
  prIntent: string; // What the PR is about
  featureGoals?: FeatureGoals; // What we want to understand about this feature
  reusableEvents: ReusableEvent[];
  affectedEntity: Entity | null;
  matchedPattern: EventPatternMatch | null;
  suggestedEvents: SuggestedEventFromReasoning[];
}

export interface ReusableEvent {
  existingEvent: DiscoveredEvent;
  suggestion: string; // How to reuse it with different property values
  confidence: number;
}

export interface EventPatternMatch {
  pattern: string; // Pattern name from general-events.ts
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
  
  // Line-level metadata for contextual suggestions
  filePath?: string; // File where the trigger was found
  diffLine?: number; // Line number in diff (from + lines)
  suggestedCode?: string; // Complete code snippet to insert
  triggerContext?: string; // Surrounding code that triggered this suggestion
}

// Event Pattern from general-events.ts
export interface EventPattern {
  pattern: RegExp | string;
  event: SaaSEvent;
  confidence: number;
}

// Code Indexer Interface
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
