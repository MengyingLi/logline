# Logline

**Semantic layer for product analytics.** Logline scans your codebase, understands your product's domain, and generates a machine-readable tracking plan — the contract between your product code, data pipelines, and AI agents.

```
Your Code  →  logline scan + spec  →  tracking-plan.json
                                             ↓
                              Segment / Amplitude / OTel
                              AI agents (LangChain, LangGraph)
                              dbt / GlassFlow / BI tools
```

## Why Logline

Every product analytics stack has the same gap: events arrive, but nothing tells your pipelines or AI agents what those events *mean* — what objects they describe, how they relate to each other, what sequences constitute success.

`tracking-plan.json` is that missing piece:
- **Event definitions** with properties and types → agents know how to parse events
- **Actor/object relationships** → agents know the JOIN paths to correlate events
- **Lifecycle states** → agents know what sequences to expect
- **Metric definitions** → agents can answer product questions without being prompted

## Quick Start

```bash
# Run once via npx (published package)
npx @logline/cli init
npx @logline/cli scan --fast

# Or install globally
npm install -g @logline/cli
logline scan --fast

# Until published in your environment: clone + build + link
git clone https://github.com/MengyingLi/logline
cd logline && npm install && npm run build && npm link

# Set your OpenAI API key (skip for --fast mode)
export OPENAI_API_KEY=sk-...

# Run in your project
cd /path/to/your-project
logline init           # initialize .logline/
logline scan           # detect missing events
logline spec           # write .logline/tracking-plan.json
logline pr --dry-run   # preview instrumentation
logline pr             # create PR
```

## Example Output

```
$ logline scan

📊 Product Profile
   Mission: Workflow automation for teams
   Key Metrics: workflows_created, workflow_executions
   Confidence: 87%

🎯 Event Coverage: 12% (2 tracked / 14 suggested)

Critical Events (track these first):
  ✗ workflow_created       src/pages/NewWorkflow.tsx:42
                           Fired when user creates a new workflow
  ✗ workflow_completed     src/components/WorkflowRunner.tsx:88
                           Fired when a workflow run finishes

High Priority:
  ✗ step_configured        src/components/StepConfigPanel.tsx:25
                           Includes: mapping_added, trigger_selected, action_configured
  ✗ template_selected      src/pages/Index.tsx:160

Already Tracked:
  ✓ workflow_edited        src/components/StepConfigPanel.tsx:103
  ✓ user_signed_up         src/auth/callback.ts:15

Run `logline spec` to update your tracking plan.
```

## Tracking Plan Format

`logline spec` generates `.logline/tracking-plan.json`:

```json
{
  "version": "1.0",
  "generatedAt": "2026-03-27T00:00:00.000Z",
  "generatedBy": "logline@0.1.0",
  "product": {
    "mission": "Workflow automation for teams",
    "keyMetrics": ["workflows_created", "workflow_executions"]
  },
  "events": [
    {
      "id": "evt_a3f7c12d",
      "name": "step_configured",
      "description": "User configured a step in their workflow",
      "actor": "User",
      "object": "Step",
      "action": "configured",
      "priority": "high",
      "status": "suggested",
      "properties": [
        { "name": "step_id",     "type": "string", "required": true },
        { "name": "workflow_id", "type": "string", "required": true,  "todo": true },
        { "name": "user_id",     "type": "string", "required": true },
        { "name": "user_id",     "type": "string", "required": false, "todo": true,
          "description": "ID of the grandparent User (for cross-entity correlation)" }
      ],
      "locations": [{ "file": "src/components/StepConfigPanel.tsx", "line": 25 }],
      "includes": ["mapping_added", "trigger_selected", "action_configured"],
      "firstSeen": "2026-03-27T00:00:00.000Z",
      "lastSeen": "2026-03-27T00:00:00.000Z"
    }
  ],
  "context": {
    "actors": [{ "name": "User", "type": "user" }],
    "objects": [
      { "name": "Workflow", "source": "prisma", "properties": ["id"] },
      { "name": "Step",     "source": "prisma", "properties": ["id"], "belongsTo": ["Workflow"] }
    ],
    "relationships": [
      { "child": "Step", "parent": "Workflow", "relationship": "belongs_to" }
    ],
    "lifecycles": [
      { "object": "Workflow", "states": ["draft", "active", "completed"] }
    ],
    "joinPaths": [
      { "from": "Step", "to": "Workflow", "via": ["Step.workflow_id → Workflow.id"] },
      { "from": "Step", "to": "User",     "via": ["Step.workflow_id → Workflow.id", "Workflow.created_by → User.id"] }
    ],
    "expectedSequences": [
      {
        "name": "workflow_activation",
        "steps": ["workflow_created", "workflow_edited", "workflow_completed"],
        "expectedWindow": "7d",
        "significance": "Measures whether users activate after creating a workflow"
      }
    ]
  },
  "metrics": [
    {
      "name": "workflow_completion_rate",
      "formula": "count(event = 'workflow_completed') / nullif(count(event = 'workflow_created'), 0)",
      "category": "activation",
      "grain": "weekly"
    }
  ],
  "coverage": { "tracked": 2, "suggested": 14, "approved": 0, "implemented": 2, "percentage": 12 }
}
```

Properties marked `"todo": true` came from the context graph (relationships, join paths) and couldn't be verified in your code's scope — you'll need to wire them up manually or verify they're available.

## Commands

| Command | Description |
|---------|-------------|
| `logline init` | Initialize `.logline/` in your project |
| `logline scan` | Detect missing events and coverage gaps |
| `logline scan --fast` | Regex-only (no LLM, instant) |
| `logline scan --granular` | Show all interactions without grouping |
| `logline scan --verbose` | Show files, interactions, LLM previews |
| `logline spec` | Generate/update `.logline/tracking-plan.json` |
| `logline pr` | Create PR with analytics instrumentation |
| `logline pr --dry-run` | Preview changes without creating PR |
| `logline status` | Show tracking plan summary (no rescan) |
| `logline approve [event]` | Mark event as approved |
| `logline approve --all` | Approve all suggested events |
| `logline reject [event]` | Mark event as deprecated |
| `logline metrics` | Generate metric definitions from context |
| `logline context` | Show product ontology (text, mermaid, json) |
| `logline export --format segment` | Export to Segment Protocols |
| `logline export --format amplitude` | Export to Amplitude taxonomy |
| `logline export --format opentelemetry` | Export OTel semantic conventions |
| `logline export --format glassflow` | Export GlassFlow filter/transform config |
| `logline doctor` | Check environment (Node, API key, git, gh) |

## Context-Aware Property Enrichment

Logline uses your codebase's relationship graph to enrich event properties automatically.

For a `step_configured` event where `Step` belongs to `Workflow`:
- `step_id` — verified from scope
- `workflow_id` — inferred from relationship (marked `todo: true` if not in scope)
- `user_id` — from auth/session patterns

For a `mapping_added` event where `Mapping` → `Step` → `Workflow`:
- `mapping_id`, `step_id`, `workflow_id` — hierarchy-enriched
- Deeper hops are marked optional

## Agent Integration

`tracking-plan.json` is designed to be loaded as agent context:

```python
import json

with open('.logline/tracking-plan.json') as f:
    plan = json.load(f)

# Give an agent the full product ontology
system_prompt = f"""
You are analyzing product events for {plan['product']['mission']}.

Events: {json.dumps(plan['events'], indent=2)}

Entity relationships (JOIN paths):
{json.dumps(plan['context']['joinPaths'], indent=2)}

Expected sequences (for anomaly detection):
{json.dumps(plan['context']['expectedSequences'], indent=2)}

Metrics you can compute:
{json.dumps(plan['metrics'], indent=2)}
"""
```

The join paths tell an agent exactly how to correlate events across entities without knowing the schema upfront. The expected sequences define what "normal" looks like — deviations are anomalies worth investigating.

## Supported Stacks

**Frameworks:** React / Next.js · Vue (coming soon) · Express / Fastify

**Databases (for schema detection):** Supabase · Prisma · Drizzle

**Analytics destinations:** Segment · PostHog · Mixpanel · Custom

## Configuration

Create `.logline/config.json`:

```json
{
  "eventGranularity": "business",
  "scan": {
    "include": ["src/**/*.{ts,tsx,js,jsx}"],
    "exclude": ["**/*.test.*", "**/node_modules/**"]
  },
  "tracking": {
    "destination": "segment"
  }
}
```

## Documentation

- `docs/tracking-plan-format.md`
- `docs/how-it-works.md`
- `docs/configuration.md`
- `docs/conventions.md`
- `docs/agent-integration.md`
- `docs/programmatic-api.md`

## Development

```bash
git clone https://github.com/MengyingLi/logline
cd logline && npm install

# Build and link for local testing
npm run build && npm link

# Run in a test project
cd /path/to/test-project && logline doctor
```

## Requirements

- Node.js 18+
- OpenAI API key (for smart detection; `--fast` mode works without it)
- Git (for `logline pr`)
- GitHub CLI `gh` (for auto PR creation)

## FAQ

**Q: I get "command not found" after `npm install -g logline`.**

The unscoped `logline` package is different. Use `@logline/cli`.

**Q: Does it work without OpenAI?**

Yes — `logline scan --fast` uses regex-only detection. Free and instant, but won't group interactions into business events.

**Q: Will it break my code?**

Use `logline pr --dry-run` to preview. Everything goes through a PR you control.

**Q: How do I use the tracking plan with AI agents?**

See the Agent Integration section above. The `context.joinPaths` and `context.expectedSequences` fields are designed specifically for agent context windows.

## License

MIT — Built by [Mengying Li](https://github.com/MengyingLi)
