# Agent Integration

`tracking-plan.json` is designed to be loaded as context for AI agents. This document shows how to use it.

## Why it helps agents

Without a tracking plan, an agent receiving analytics events has to guess:
- What does `step_configured` mean?
- Which user performed it? Which workflow does it belong to?
- Is this sequence of events normal or anomalous?
- What metric does this event feed into?

With `tracking-plan.json`, all of these are answered upfront.

## Loading as system context

```python
import json

with open('.logline/tracking-plan.json') as f:
    plan = json.load(f)

system_prompt = f"""
You are analyzing product events for: {plan['product']['mission']}

## Event Definitions
{json.dumps(plan['events'], indent=2)}

## Entity Relationships (JOIN paths for correlation)
{json.dumps(plan['context']['joinPaths'], indent=2)}

## Expected Sequences (deviations = anomalies)
{json.dumps(plan['context']['expectedSequences'], indent=2)}

## Metrics you can compute
{json.dumps(plan['metrics'], indent=2)}
"""
```

## Using join paths for event correlation

Join paths tell agents how to connect events that belong to different entities:

```python
# Given an event: { name: "step_configured", properties: { step_id: "s_123", workflow_id: "w_456" } }
# The agent can use the join path to find related workflow_created events:

join_path = next(
    jp for jp in plan['context']['joinPaths']
    if jp['from'] == 'Step' and jp['to'] == 'Workflow'
)
# join_path['via'] = ["Step.workflow_id → Workflow.id"]
# → Query: SELECT * FROM events WHERE name = 'workflow_created' AND workflow_id = 'w_456'
```

## Using expected sequences for anomaly detection

```python
for seq in plan['context']['expectedSequences']:
    # seq = {
    #   "name": "workflow_activation",
    #   "steps": ["workflow_created", "workflow_edited", "workflow_completed"],
    #   "expectedWindow": "7d"
    # }
    # Check: did workflow_created get followed by workflow_completed within 7d?
    pass
```

## GlassFlow + Logline

Export the tracking plan as a GlassFlow config:

```bash
logline export --format glassflow --output glassflow-config.json
```

GlassFlow uses the exported config to filter, normalize, and validate events before they reach your warehouse or agent.

## LangChain example

```python
from langchain.chat_models import ChatOpenAI
from langchain.schema import SystemMessage, HumanMessage
import json

plan = json.load(open('.logline/tracking-plan.json'))
llm = ChatOpenAI(model="gpt-4")

# Agent knows your product ontology
response = llm([
    SystemMessage(content=f"Product ontology: {json.dumps(plan['context'])}"),
    HumanMessage(content="Which users created a workflow but never completed one in the last 7 days?")
])
# Agent knows to JOIN Step → Workflow → User via the join paths
# Agent knows workflow_activation sequence = [workflow_created, ..., workflow_completed]
```

## Keeping the plan in sync

```bash
# In CI or as a pre-commit hook:
logline spec --fast   # regenerate without LLM (fast, deterministic)
git add .logline/tracking-plan.json
```

The plan's `id` field for each event is a stable hash of the event name — same name always produces the same ID, so the plan merges cleanly across runs.

## Signal type routing

Each event in the tracking plan has a `signalType` field. Agents can use this to understand the nature of each signal and prioritize accordingly:

- **`action`** signals answer "what did the user do?" — useful for product analytics, funnel analysis, and user behavior modeling
- **`operation`** signals answer "what did the system do?" — useful for debugging, latency analysis, and infrastructure observability
- **`error`** signals answer "what went wrong?" — useful for incident response, root cause analysis, and reliability tracking
- **`state_change`** signals answer "how did entities transition?" — useful for lifecycle analysis, cohort segmentation, and anomaly detection

### Triage strategy for agents

When an agent receives a stream of events, `signalType` enables systematic triage:

```python
events = json.loads(open(".logline/tracking-plan.json").read())["events"]

# Group by signal type for analysis
by_signal = {}
for e in events:
    sig = e.get("signalType", "action")
    by_signal.setdefault(sig, []).append(e["name"])

# An agent investigating an incident can:
# 1. Start with error signals → what failed?
errors = by_signal.get("error", [])
# 2. Correlate with operation signals → what was the system doing?
ops = by_signal.get("operation", [])
# 3. Use action signals → what was the user trying to do?
actions = by_signal.get("action", [])
# 4. Use state_change signals → what lifecycle transitions occurred?
states = by_signal.get("state_change", [])
```

Because `action` and `state_change` signals go to analytics while `operation` and `error` go to structured logging, an agent can join across both data stores using the shared event name and timestamp.

