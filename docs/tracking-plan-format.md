# Tracking Plan Format

`.logline/tracking-plan.json` is a machine-readable product ontology. This document describes every field.

## Top-level

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version (`"1.0"`) |
| `generatedAt` | ISO 8601 | When this plan was last generated |
| `generatedBy` | string | `"logline@<version>"` |
| `product` | ProductProfile | Product understanding (from LLM analysis) |
| `events` | TrackingPlanEvent[] | All events (suggested + implemented + approved) |
| `context` | TrackingPlanContext | Product ontology: actors, objects, relationships |
| `metrics` | TrackingPlanMetric[] | Auto-generated metric definitions |
| `coverage` | CoverageStats | Instrumentation coverage summary |

## ProductProfile

```json
{
  "mission": "Workflow automation for teams",
  "valueProposition": "...",
  "businessGoals": ["increase activation", "reduce churn"],
  "userPersonas": ["developer", "ops engineer"],
  "keyMetrics": ["workflows_created", "workflow_executions"],
  "confidence": 0.87
}
```

## TrackingPlanEvent

```json
{
  "id": "evt_a3f7c12d",
  "name": "step_configured",
  "description": "User configured a step in their workflow",
  "actor": "User",
  "object": "Step",
  "action": "configured",
  "priority": "high",
  "status": "suggested",
  "properties": [...],
  "locations": [{ "file": "src/components/StepConfigPanel.tsx", "line": 25 }],
  "includes": ["mapping_added", "trigger_selected"],
  "firstSeen": "2026-03-27T00:00:00.000Z",
  "lastSeen": "2026-03-27T00:00:00.000Z"
}
```

### status lifecycle

```
suggested → approved → implemented → deprecated
```

- `suggested` — detected by Logline, not yet approved
- `approved` — human-approved, awaiting instrumentation (`logline approve`)
- `implemented` — `track()` call detected in codebase
- `deprecated` — intentionally removed (`logline reject`)

### priority

- `critical` — activation events (first value moments)
- `high` — core engagement events
- `medium` — supporting events
- `low` — diagnostic/debug events

## EventProperty

```json
{
  "name": "workflow_id",
  "type": "string",
  "required": true,
  "description": "ID of the parent Workflow",
  "todo": true
}
```

`todo: true` means this property was inferred from the context graph (relationships, join paths) but couldn't be verified in your code's scope at the detection point. You need to verify it's accessible and wire it up.

## TrackingPlanContext

The context is the product ontology — what your app contains and how entities relate.

### actors

Who performs actions. Detected from auth patterns (`req.user`, `useAuth`, etc.).

```json
{
  "name": "User",
  "type": "user",
  "source": "inferred",
  "identifierPattern": "user.id",
  "confidence": 0.7
}
```

### objects

Domain entities. Detected from Prisma models, Supabase tables, API routes.

```json
{
  "name": "Workflow",
  "source": "prisma",
  "properties": ["id"],
  "belongsTo": [],
  "exposedViaAPI": true,
  "confidence": 0.9
}
```

### relationships

How objects relate to each other. Detected from foreign key patterns (`workflowId`, `workflow_id`).

```json
{
  "child": "Step",
  "parent": "Workflow",
  "relationship": "belongs_to",
  "contextImplication": "Detected foreign-key field workflowId in src/api/steps.ts"
}
```

### joinPaths

How to connect entities in queries. Agents use this to correlate events across entities without knowing the schema.

```json
{
  "from": "Step",
  "to": "User",
  "via": [
    "Step.workflow_id → Workflow.id",
    "Workflow.created_by → User.id"
  ]
}
```

### lifecycles

State machines. Detected from TypeScript enums and union types.

```json
{
  "object": "Workflow",
  "states": ["draft", "active", "completed"],
  "transitions": []
}
```

### expectedSequences

What event sequences constitute success. Used by agents for anomaly detection.

```json
{
  "name": "workflow_activation",
  "steps": ["workflow_created", "workflow_edited", "workflow_completed"],
  "expectedWindow": "7d",
  "significance": "Measures whether users activate after creating a workflow"
}
```

## TrackingPlanMetric

Auto-generated metric definitions from events + context.

```json
{
  "id": "m_a3f7c12d",
  "name": "workflow_completion_rate",
  "description": "Share of Workflows created that reach completed",
  "formula": "count(event = 'workflow_completed') / nullif(count(event = 'workflow_created'), 0)",
  "events": ["workflow_created", "workflow_completed"],
  "category": "activation",
  "grain": "weekly",
  "status": "suggested"
}
```

## CoverageStats

```json
{
  "tracked": 2,
  "suggested": 14,
  "approved": 0,
  "implemented": 2,
  "percentage": 12
}
```

`percentage` = `implemented / (implemented + suggested + approved) * 100`
