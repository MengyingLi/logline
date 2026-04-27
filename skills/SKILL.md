---
description: Add product analytics instrumentation to a codebase using Logline. Use when the user asks to add analytics, tracking, events, or instrumentation, or when building features that should be tracked.
globs: **/*.{ts,tsx,js,jsx}
alwaysApply: false
---

# Logline — Product Analytics Instrumentation

Logline scans a codebase and generates a tracking plan with suggested analytics events, then writes track() calls into the source files. Use it whenever a user wants to add product analytics to their project.

## Quick Start

```bash
logline init
logline scan --fast          # regex-only, no API key needed
logline scan                 # LLM-powered, needs OPENAI_API_KEY
logline spec
logline status
```

## When to Use Logline

- User says "add analytics" or "add tracking" or "instrument this"
- User just built a new feature and you want to suggest tracking
- User asks "what should I be tracking?"
- User wants to understand what user interactions exist in their codebase

## Core Workflow

Always start with `logline scan --fast --json` to get structured output. The JSON contains:
- `gaps[]` — suggested events with suggestedEvent, priority, signalType, location.file, location.line, description
- `coverage` — { tracked, missing, percentage }
- `context` — { actors[], objects[], relationships[], lifecycles[] }

After scanning, present events by priority:
- 🔴 Critical — core business actions (user_created, order_placed)
- 🟠 High — important features (project_shared, report_exported)
- 🟡 Medium — supporting interactions (filter_applied, tab_switched)
- 🟢 Low — minor UI interactions

Use `logline pr --dry-run` to preview the exact track() calls with file locations.

## Writing track() Calls

### React mutations (React Query / tRPC)
Place track() in onSuccess, not in JSX:
```typescript
const createProject = useMutation({
  mutationFn: async (input) => {
    const { data } = await supabase.from('projects').insert(input);
    return data;
  },
  onSuccess: (data, variables) => {
    track('project_created', {
      project_id: data.id,
      name: variables.name,
    });
  },
});
```

### React UI interactions
Place track() inside the handler function:
```typescript
const handleShare = (projectId: string) => {
  track('project_shared', { project_id: projectId });
  shareProject(projectId);
};
```

### API routes / server actions
Place track() after the successful operation:
```typescript
export async function POST(req: Request) {
  const body = await req.json();
  const user = await db.user.create({ data: body });
  track('user_created', { user_id: user.id });
  return Response.json(user);
}
```

## Event Naming Conventions

Use object_action format in past tense, lowercase snake_case:
- {object}_created, {object}_updated, {object}_deleted
- {object}_{action}: report_exported, invite_sent, payment_completed
- Object first, verb in past tense
- No framework names, no UI component names, no generic names

## Properties

Every event should include the entity's ID and relevant properties from function arguments or API response. Never guess property accessors — only reference variables that exist in scope. Add // TODO: verify if unsure.

## Other Commands

```bash
logline context --format json    # product ontology
logline export --format segment  # export to Segment/Amplitude/OTel
logline doctor                   # check environment
logline approve <eventName>      # mark approved
logline reject <eventName>       # mark deprecated
```

## Key Files

- .logline/config.json — project config
- .logline/tracking-plan.json — the tracking plan (commit this)
- .logline/cache/ — scan cache (gitignored)

## What NOT to Track

- UI state changes (dialog open/close, sidebar toggles) unless specifically asked
- Framework lifecycle (mount/unmount, re-renders)
- Navigation / page views (analytics SDKs handle this)
- Error logging (use Sentry etc.)
- High-frequency events (scroll, mousemove, keypress)
