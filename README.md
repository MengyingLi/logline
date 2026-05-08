# Logline

[![npm version](https://img.shields.io/npm/v/logline-cli.svg)](https://www.npmjs.com/package/logline-cli)
[![CI](https://github.com/MengyingLi/logline/actions/workflows/ci.yml/badge.svg)](https://github.com/MengyingLi/logline/actions)

**Automated product analytics instrumentation.** Logline scans your codebase, understands your product's domain model, and generates a machine-readable tracking plan — then instruments the code for you.

```
logline scan    →  finds what's missing
logline spec    →  writes tracking-plan.json
logline apply   →  inserts track() calls into your code
```

## Quick Start

```bash
npm install -g logline-cli

cd /path/to/your-project
logline init           # interactive setup: choose destination, paste API key
logline scan --fast    # detect missing events (no API key needed)
logline spec           # write .logline/tracking-plan.json
logline apply          # interactively instrument your code
```

> **OpenAI API key** is optional. `--fast` mode uses regex-only detection — free, instant, no external calls. Set `OPENAI_API_KEY` for LLM-powered event synthesis.

## Example Output

```
$ logline scan --fast

Gaps — 5 events to instrument

  ✗ workflow_created      src/app/workflows.tsx:45      critical
  ✗ plan_upgraded         src/app/billing.tsx:112       high
  ✗ member_invited        src/app/team.tsx:67           high
  ✗ comment_created       src/app/comments.tsx:23       medium
  ✗ search_performed      src/components/Search.tsx:14  medium

✓ Tracking: segment_identified · page_viewed · signup_completed  and 3 more

Coverage  ████████░░░░░░░░░░░░  34%  8 tracked · 15 gaps
Run `logline spec` to save to tracking plan, then `logline apply` to instrument.
```

```
$ logline apply

──────────────────────────────────────────────
[1/5] workflow_created  (critical)
src/app/workflows.tsx:45

 43 │   async function handleSubmit(data: WorkflowInput) {
 44 │     const workflow = await createWorkflow(data);
    │     track('workflow_created', { workflow_id: workflow.id, name: data.name });
 45 │     router.push(`/workflows/${workflow.id}`);

[a]ccept  [s]kip  [e]dit name  [q]uit
> a
✓ Applied workflow_created to src/app/workflows.tsx
```

## Logline Cloud

Connect track calls to the Logline dashboard for live event stream, tracking plan coverage, and drift detection.

```bash
logline init   # choose "Logline Cloud", paste your lk_... key
```

This creates `.logline/track.ts`:

```typescript
import { init, track } from 'logline-cli/sdk';
init({ apiKey: process.env.LOGLINE_API_KEY ?? 'lk_...' });
export { track };
```

`logline apply` automatically imports from `.logline/track` — no manual wiring needed.

Or send events directly:

```bash
curl -X POST https://logline.dev/api/v1/events/ingest \
  -H "Authorization: Bearer lk_..." \
  -H "Content-Type: application/json" \
  -d '{"event": "workflow_created", "properties": {"workflow_id": "abc"}}'
```

Fan-out to Segment, PostHog, Mixpanel, or Amplitude is configured per-repo in the dashboard.

## Tracking Plan Format

`logline spec` writes `.logline/tracking-plan.json`:

```json
{
  "version": "1.0",
  "events": [
    {
      "id": "evt_a3f7c12d",
      "name": "workflow_created",
      "actor": "User",
      "object": "Workflow",
      "action": "created",
      "priority": "critical",
      "status": "approved",
      "properties": [
        { "name": "workflow_id", "type": "string", "required": true },
        { "name": "name",        "type": "string", "required": true },
        { "name": "user_id",     "type": "string", "required": true }
      ],
      "locations": [{ "file": "src/app/workflows.tsx", "line": 45 }]
    }
  ],
  "context": {
    "actors": [{ "name": "User", "type": "user" }],
    "objects": [
      { "name": "Workflow", "source": "prisma", "belongsTo": [] },
      { "name": "Step",     "source": "prisma", "belongsTo": ["Workflow"] }
    ],
    "joinPaths": [
      { "from": "Step", "to": "User", "via": ["Step.workflow_id → Workflow.id", "Workflow.created_by → User.id"] }
    ],
    "expectedSequences": [
      { "name": "activation", "steps": ["workflow_created", "workflow_edited", "workflow_completed"], "expectedWindow": "7d" }
    ]
  },
  "metrics": [
    { "name": "workflow_completion_rate", "formula": "count(workflow_completed) / nullif(count(workflow_created), 0)", "category": "activation" }
  ]
}
```

## Commands

| Command | Description |
|---------|-------------|
| `logline init` | Interactive setup: destination, API key, AI skill files |
| `logline scan` | Detect missing events and coverage gaps |
| `logline scan --fast` | Regex-only, no LLM, instant |
| `logline scan --json` | Machine-readable output |
| `logline spec` | Generate/update `.logline/tracking-plan.json` |
| `logline apply` | Interactively insert `track()` calls into source files |
| `logline approve` | Interactive review: approve / skip / reject each suggested event |
| `logline approve --all` | Approve all suggested events at once |
| `logline reject [event]` | Mark an event as deprecated |
| `logline lint` | Validate existing `track()` calls against the tracking plan |
| `logline lint --json` | Machine-readable lint output (CI-friendly, exits 1 on errors) |
| `logline status` | Coverage bar, pending events, next action |
| `logline open` | Open the Logline dashboard in your browser |
| `logline pr` | Create a PR with analytics instrumentation |
| `logline pr --dry-run` | Preview changes without creating PR |
| `logline doctor` | Check Node, API keys, git, source files |
| `logline export --format segment` | Export to Segment Protocols |
| `logline export --format amplitude` | Export to Amplitude taxonomy |
| `logline export --format opentelemetry` | Export OTel semantic conventions |
| `logline export --format glassflow` | Export GlassFlow filter/transform config |
| `logline metrics` | Generate metric definitions from context |
| `logline context` | Show product ontology (text, mermaid, json) |
| `logline completion --shell zsh` | Print shell completion script |

## Lint

`logline lint` validates every `track()` call in your source files against the tracking plan — catching unknown events, missing required properties, and calls to deprecated events before they ship.

```
$ logline lint

Linting track() calls across the codebase...

src/app/billing.tsx
  ✗    8  plan_upgraded                      'plan_upgraded' is not in the tracking plan  (did you mean 'subscription_upgraded'?)
  ✗   23  subscription_created               missing required property 'plan_id'

src/app/auth.tsx
  ⚠   45  legacy_signup                      'legacy_signup' is deprecated in the tracking plan

3 calls — 2 errors, 1 warning, 0 clean
```

Use `--json` for CI pipelines — exits with code 1 when errors are found:

```bash
logline lint --json | jq '.violations[] | select(.severity == "error")'
```

## Semantic Conventions

Logline detects which analytics domains your codebase uses and checks coverage against built-in event conventions:

| Domain | Activates when | Events covered |
|--------|---------------|----------------|
| `onboarding` | signup/verify/onboarding flow code | signup attempt/success/fail, email verification, onboarding steps |
| `billing` | Stripe/Paddle imports, checkout/subscription code | trial lifecycle, plan changes, payment outcomes |
| `search` | Algolia/Typesense imports, SearchBar components | search performed, result clicked, filters, zero results |
| `collaboration` | invite/member/workspace code | member invited/accepted/declined, role changes, workspace lifecycle |

When a domain is detected, `logline scan` shows a coverage report:

```
Convention Coverage — billing

  ✗ subscription_trial_start   Trial start not instrumented — required for conversion funnel
  ✗ payment_fail               Payment failure handler not instrumented — required for revenue recovery
  ✓ subscription_created       src/app/billing.tsx:89
```

## Signal Types

Logline routes signals to the right destination from the same scan:

| Signal | Captures | Generated code | Destination |
|--------|----------|----------------|-------------|
| `action` | User clicks, form submits, creates | `track()` | Segment, PostHog, Mixpanel |
| `operation` | API calls, background jobs | `logger.info()` | Datadog, Grafana |
| `state_change` | Status transitions | `track()` + `logger.info()` | Analytics + Logging |
| `error` | Failures, timeouts | `logger.error()` | Logging + Alerts |

Configure the logging destination in `.logline/config.json`:

```json
{
  "logging": {
    "destination": "pino",
    "importPath": "@/lib/logger",
    "instanceName": "logger"
  }
}
```

## Agent Integration

`tracking-plan.json` is designed to be loaded as agent context:

```python
import json

with open('.logline/tracking-plan.json') as f:
    plan = json.load(f)

system_prompt = f"""
Product: {plan['product']['mission']}

Events: {json.dumps(plan['events'], indent=2)}

Entity JOIN paths:
{json.dumps(plan['context']['joinPaths'], indent=2)}

Expected sequences (anomaly detection baseline):
{json.dumps(plan['context']['expectedSequences'], indent=2)}

Metrics you can compute:
{json.dumps(plan['metrics'], indent=2)}
"""
```

`joinPaths` tells an agent exactly how to correlate events across entities without knowing the schema upfront. `expectedSequences` define what "normal" looks like — deviations are anomalies.

## Shell Completions

```bash
# zsh
echo 'eval "$(logline completion --shell zsh)"' >> ~/.zshrc

# bash
echo 'eval "$(logline completion --shell bash)"' >> ~/.bashrc

# fish
logline completion --shell fish > ~/.config/fish/completions/logline.fish
```

## Programmatic API

Use Logline as a library in GitHub Apps, CI pipelines, or editor plugins:

```typescript
import { scanCommand, synthesizeEvents, detectInteractions } from 'logline-cli';

const result = await scanCommand({ cwd: '/path/to/repo', fast: true });
console.log(result.gaps.map(g => g.suggestedEvent));
```

Full API: [`docs/programmatic-api.md`](docs/programmatic-api.md)

## Configuration

`.logline/config.json` (created by `logline init`):

```json
{
  "eventGranularity": "business",
  "tracking": {
    "destination": "logline",
    "importPath": ".logline/track",
    "functionName": "track"
  },
  "scan": {
    "include": ["src/**/*.{ts,tsx,js,jsx}"],
    "exclude": ["**/*.test.*", "**/node_modules/**", "**/scripts/**"]
  }
}
```

## Requirements

- Node.js 20+
- OpenAI API key — optional, enables LLM-powered event synthesis (`--fast` works without it)
- Git — for `logline pr`
- GitHub CLI `gh` — for auto PR creation

## Development

```bash
git clone https://github.com/MengyingLi/logline
cd logline && npm install && npm run build && npm link

# Test in any project
cd /path/to/test-project
logline doctor
```

## FAQ

**Q: Does it work without OpenAI?**
Yes — `logline scan --fast` uses regex-only detection. No API key, no cost, instant results.

**Q: Will it break my code?**
`logline apply` shows a diff preview before every edit and requires explicit `[a]ccept`. Nothing is changed without your confirmation.

**Q: How does it know which events matter?**
A relevance scoring system (0–1) combines five signals: schema match, file relevance, cross-reference count, entity quality, and interaction type. Events below 0.25 are filtered out.

**Q: I get "command not found" after installing `logline`.**
The unscoped `logline` package is different. Use `logline-cli`: `npm install -g logline-cli`.

## License

MIT — Built by [Mengying Li](https://github.com/MengyingLi)
