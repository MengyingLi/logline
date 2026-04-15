# How It Works

Logline runs a multi-stage pipeline on your codebase.

## Pipeline

```
Stage 1: Load files
  ↓  All .ts/.tsx/.js/.jsx files, respecting .gitignore
Stage 2: Inventory
  ↓  Find existing track() / analytics.track() calls
Stage 3: Product profile
  ↓  LLM: What does this product do? What matters?
Stage 4: Detect interactions
  ↓  Regex: Click handlers, form submits, route handlers, mutations
Stage 4b: Extract context
  ↓  Regex: Actors, objects, relationships, lifecycles from code patterns
Stage 5: Synthesize events
  ↓  LLM: Group interactions → meaningful business events
Stage 6: Refine locations
  ↓  Find the best insertion point for each event
Stage 7: Infer properties
  ↓  Scope analysis + context graph → property list per event
```

Results are cached in `.logline/cache/scan.json` keyed by codebase hash + options. Unchanged codebases skip everything after Stage 1.

## Stage 4: Interaction Detection

Detects code patterns that represent user actions:

- `onClick`, `onSubmit`, `onChange` handlers
- `async function handle*()` patterns
- Route handlers (Next.js, Express)
- Prisma/Supabase mutations (`.create`, `.update`, `.delete`)
- State transitions and toggle patterns

Each interaction gets a `confidence` score. Low-confidence interactions (background jobs, internal state) are filtered out.

## Stage 4b: Context Extraction

Builds the product ontology from code patterns:

**Actors** — detected from:
- `req.user`, `request.user`, `session.user`
- `useAuth()`, `useUser()`, `useSession()`
- Stripe webhook patterns → `Stripe` actor

**Objects** — detected from:
- Prisma: `prisma.workflow.create(...)` → `Workflow`
- Supabase: `supabase.from('workflows')` → `Workflow`
- API routes: `/api/workflows` → `Workflow`

**Relationships** — detected from foreign key patterns:
- `workflowId`, `workflow_id` → `Step belongs_to Workflow`

**Lifecycles** — detected from TypeScript enums/unions:
- `enum WorkflowStatus { DRAFT, ACTIVE, COMPLETED }`
- `type Status = 'draft' | 'active' | 'completed'`

## Stage 5: Event Synthesis

The LLM receives a batch of raw interactions and produces grouped business events.

Instead of one event per interaction, related interactions get grouped:
- `handleAddMapping`, `handleDeleteMapping`, `handleUpdateTrigger` → `workflow_edited`

Event names follow `{object}_{past_tense_verb}` convention.

`--fast` mode skips the LLM and uses regex-based naming directly.

## Stage 7: Property Inference

For each event, Logline:
1. Analyzes the scope at the insertion point (parameters, useState, useContext, destructuring)
2. Checks if the object variable is in scope → `verified: true`
3. Walks the relationship graph to find parent/grandparent IDs → adds with `todo: true`
4. Checks expected sequences for sequence-aware properties (e.g. `time_to_complete_ms`)

## Caching

The scan cache lives at `.logline/cache/scan.json`. It's keyed by:
- SHA-256 hash of all file contents
- Scan options (fast, deep, granular)
- Config (include/exclude patterns, event granularity)

Any change to any source file invalidates the cache entirely.

## Configuration

`.logline/config.json` options:

```json
{
  "eventGranularity": "business",
  "scan": {
    "include": ["src/**/*.{ts,tsx,js,jsx}"],
    "exclude": ["**/*.test.*", "**/node_modules/**", "dist/**"]
  },
  "tracking": {
    "destination": "segment",
    "debug": false
  }
}
```

`eventGranularity`:
- `"business"` (default) — group related interactions into business events
- `"granular"` — one event per interaction (same as `--granular` flag)
