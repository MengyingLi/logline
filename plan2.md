# PLAN-MONTH2.md — Ship CLI + GitHub App

> **How to use:** Tell Claude Code `Read PLAN-MONTH2.md and execute Day X`

---

## Architecture

```
@logline/cli (PUBLIC repo — github.com/MengyingLi/logline)
├── CLI commands (scan, spec, pr, metrics, context, export, etc.)
├── Core pipeline (detect, synthesize, locate, infer — already exported)
├── Conventions (onboarding YAML, OTel-style)
└── src/index.ts — clean programmatic API for library consumers

logline-app (PRIVATE repo)
├── Vercel serverless functions
├── GitHub App webhook handler
├── Diff-only analysis (imports @logline/cli pipeline stages)
├── GitHub API: inline PR comments with suggested changes
├── Feedback loop: accept/reject stored per-repo
├── Tracking plan auto-sync on merge
├── Billing: Stripe ($5/mo)
├── Auth: GitHub App installation flow
└── Dashboard (stretch goal)
```

**Free vs. Paid:**
- `@logline/cli` — free, open source, npm package
- GitHub App — $5/mo per repo (or per org)

---

## Current State (after Month 1)

**6,593 lines across 41 TypeScript files. Compiles cleanly.**

**Commands:** init, scan, spec, pr, status, approve, reject, metrics, context, export (10 total)

**What's built:**
- Full pipeline (stages 01-07 + 04b context extraction) with clean exports
- LLM synthesis (688 lines), scope analyzer (406 lines), interaction detection (542 lines)
- Actor/object extraction, lifecycle detection, join paths, expected sequences
- Conventions system with OTel-inspired YAML format
- Export to Segment, Amplitude, OpenTelemetry, GlassFlow
- Ora spinners, --verbose, --json, --fast flags
- Caching with codebase hashing

**What's missing:**
- No tests
- No docs/ directory
- Not published to npm (`"private": true`)
- npm name `logline` is taken → using `@logline/cli`
- No programmatic API entry point (just CLI commands)
- README mentions old install flow

**Types ready for GitHub App (already in src/lib/types.ts):**
- `PRContext` — { prNumber, repo, owner, branch, baseBranch, diff, filesChanged, author }
- `EventSuggestion` — { eventName, properties, rationale, codeLocation, diffLine, suggestedCode, triggerContext }
- `DeveloperFeedback` — { type: approve|reject|modify, eventSuggestion, comments }
- `EpisodicMemory` — { prContext, interactions, feedback }

---

## Week 0: Ship the CLI (Days 1-5)

**Theme:** Get @logline/cli published and usable before building anything on top of it.

### Day 1: Programmatic API + package restructure

The GitHub App will `import { detectInteractions, synthesizeEvents } from '@logline/cli'`. Right now the pipeline exports exist but there's no clean top-level entry point.

**Step 1: Create `src/index.ts` — the library entry point**

```typescript
/**
 * @logline/cli — Programmatic API
 *
 * Use this to integrate Logline's analysis engine into other tools
 * (GitHub Apps, CI pipelines, editor plugins, etc.)
 */

// Core pipeline stages (the building blocks)
export {
  loadCodebaseFiles,
  runInventory,
  analyzeProduct,
  detectInteractions,
  extractContext,
  synthesizeEvents,
  findBestLocation,
  inferEventProperties,
} from './lib/pipeline';

// High-level commands (for running full workflows)
export { scanCommand, type ScanResult } from './commands/scan';

// Tracking plan utilities
export {
  readTrackingPlan,
  writeTrackingPlan,
  mergeTrackingPlan,
  generateEventId,
  getTrackingPlanPath,
  createEmptyTrackingPlan,
} from './lib/utils/tracking-plan';

// Context extraction
export { extractActorsAndObjects } from './lib/context/actor-object-extractor';
export { detectLifecycles } from './lib/context/lifecycle-detector';
export { generateMetrics } from './lib/context/metric-generator';
export { generateExpectedSequences } from './lib/context/expected-sequence';

// Code generation
export { generateTrackingCode, analyzeCodeContext } from './lib/utils/code-generator';
export { analyzeScope } from './lib/utils/scope-analyzer';

// Types (everything a consumer needs)
export type {
  // Core
  FileContent, CodeLocation, ProductProfile, DetectedEvent, EventProperty,
  // Tracking plan
  TrackingPlan, TrackingPlanEvent, TrackingPlanContext, TrackingPlanMetric,
  CoverageStats, JoinPath, ExpectedSequence,
  // PR integration (GitHub App will use these)
  PRContext, EventSuggestion, DeveloperFeedback, EpisodicMemory,
  // Actor/Object model
  Actor, TrackedObject, ObjectToObjectRelationship, ObjectLifecycle,
  InteractionTypes, ActorToObjectInteraction,
} from './lib/types';

// Pipeline types
export type {
  RawInteraction, SynthesizedEvent, InventoryResult, InstrumentableEvent,
  PropertySpec, PipelineResult,
} from './lib/pipeline/types';
```

Some of these exports may not exist yet with the exact names above — check what's actually exported from each module and adjust. The point is: one `import from '@logline/cli'` gives you everything.

**Step 2: Update package.json**

```json
{
  "name": "@logline/cli",
  "version": "0.1.0",
  "description": "Auto-instrument product analytics from your codebase",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/MengyingLi/logline"
  },
  "homepage": "https://github.com/MengyingLi/logline",
  "keywords": ["analytics", "tracking", "instrumentation", "product-analytics", "opentelemetry"],
  "bin": {
    "logline": "./dist/cli.js"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.js"
    }
  },
  "engines": {
    "node": ">=18"
  },
  "files": [
    "dist",
    "conventions"
  ],
  "scripts": {
    "build": "tsc",
    "test": "node --test test/",
    "prepublishOnly": "npm run build && npm test",
    "dev:scan": "tsx src/cli.ts scan",
    "start": "node dist/cli.js"
  }
}
```

Key changes: remove `"private": true`, add `"main"` + `"types"` + `"exports"` for library use, add `"engines"`, scoped name.

**Step 3: Update tsconfig.json**

Ensure declaration files are generated:
```json
{
  "compilerOptions": {
    "declaration": true,
    "declarationMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "sourceMap": true,
    ...existing options
  },
  "include": ["src"],
  "exclude": ["test", "node_modules", "dist"]
}
```

**Step 4: Verify**

```bash
npm run build
# Check dist/index.js and dist/index.d.ts exist
ls dist/index.js dist/index.d.ts
# Test library import works
node -e "const l = require('./dist/index.js'); console.log(Object.keys(l).length, 'exports')"
```

### Day 2: Tests

**Step 1: Set up test infrastructure**

Use Node's built-in test runner (already in package.json scripts):

```bash
mkdir -p test/fixtures
```

**Step 2: Create test fixtures**

Three minimal but realistic projects:

`test/fixtures/nextjs-saas/` — 5-6 files:
- `package.json` with next, @supabase/supabase-js
- `src/app/page.tsx` with useState, onClick handlers
- `src/app/api/workflows/route.ts` with POST/GET handlers
- `src/lib/analytics.ts` with `analytics.track('page_viewed', ...)` (existing tracking)
- `src/components/WorkflowEditor.tsx` with handleCreate, handleDelete handlers

`test/fixtures/express-api/` — 4-5 files:
- `package.json` with express, prisma
- `prisma/schema.prisma` with User, Project, Task models
- `src/routes/tasks.ts` with router.post/put/delete
- `src/index.ts` with app setup

`test/fixtures/react-spa/` — 4-5 files:
- `package.json` with react
- `src/App.tsx` with useContext, custom hooks
- `src/hooks/useAuth.ts` with useAuth returning { user }
- `src/components/SettingsForm.tsx` with form submission, toggles

**Step 3: Write tests**

```typescript
// test/scan.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanCommand } from '../src/commands/scan';

describe('scan', () => {
  it('finds existing analytics calls in nextjs-saas', async () => {
    const result = await scanCommand({ cwd: 'test/fixtures/nextjs-saas', fast: true, json: true });
    assert.ok(result.events.length > 0, 'should find existing track() calls');
  });

  it('detects interactions in nextjs-saas', async () => {
    const result = await scanCommand({ cwd: 'test/fixtures/nextjs-saas', fast: true, json: true });
    assert.ok(result.gaps.length > 0, 'should suggest events');
  });

  it('no garbage event names', async () => {
    for (const fixture of ['nextjs-saas', 'express-api', 'react-spa']) {
      const result = await scanCommand({ cwd: `test/fixtures/${fixture}`, fast: true, json: true });
      const garbagePattern = /^(\w+)_\1ed$/;
      const garbage = result.gaps.filter(g => garbagePattern.test(g.suggestedEvent));
      assert.equal(garbage.length, 0, `garbage events in ${fixture}: ${garbage.map(g => g.suggestedEvent)}`);
    }
  });

  it('handles empty project gracefully', async () => {
    await assert.rejects(
      () => scanCommand({ cwd: 'test/fixtures/empty', fast: true, json: true }),
      /No source files found/
    );
  });

  it('detects route handlers in express-api', async () => {
    const result = await scanCommand({ cwd: 'test/fixtures/express-api', fast: true, json: true });
    const hasCreate = result.gaps.some(g => g.suggestedEvent.includes('created'));
    assert.ok(hasCreate, 'should detect route handlers that create entities');
  });
});

// test/tracking-plan.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTrackingPlan, generateEventId, createEmptyTrackingPlan } from '../src/lib/utils/tracking-plan';

describe('tracking plan', () => {
  it('generates stable event IDs', () => {
    const id1 = generateEventId('workflow_created');
    const id2 = generateEventId('workflow_created');
    assert.equal(id1, id2);
    assert.ok(id1.startsWith('evt_'));
  });

  it('merge preserves approved events', () => {
    // Create existing plan with an approved event
    const existing = createEmptyTrackingPlan();
    existing.events = [{
      id: generateEventId('workflow_created'),
      name: 'workflow_created',
      description: 'Original description',
      actor: 'User', object: 'Workflow', action: 'created',
      properties: [], locations: [],
      priority: 'high', status: 'approved',
      firstSeen: '2026-01-01', lastSeen: '2026-01-01',
    }];

    // Merge with new scan that has same event with different description
    const newEvents = [{
      ...existing.events[0],
      description: 'New description from scan',
      status: 'suggested' as const,
    }];

    const merged = mergeTrackingPlan(existing, newEvents, existing.product, existing.coverage);
    const event = merged.events.find(e => e.name === 'workflow_created');
    assert.equal(event?.status, 'approved', 'should preserve approved status');
    assert.equal(event?.description, 'Original description', 'should not overwrite approved description');
  });

  it('merge is idempotent', () => {
    const plan = createEmptyTrackingPlan();
    const events = [{ id: 'evt_test', name: 'test_event', description: 'test', actor: 'User', object: 'Test', action: 'created', properties: [], locations: [], priority: 'medium' as const, status: 'suggested' as const, firstSeen: '2026-01-01', lastSeen: '2026-01-01' }];
    const merged1 = mergeTrackingPlan(plan, events, plan.product, plan.coverage);
    const merged2 = mergeTrackingPlan(merged1, events, plan.product, plan.coverage);
    assert.equal(merged1.events.length, merged2.events.length);
  });
});

// test/event-name.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isValidEventName, isBusinessEvent, toSnakeCaseFromPascalOrCamel } from '../src/lib/utils/event-name';

describe('event names', () => {
  it('rejects garbage names', () => {
    assert.equal(isValidEventName('save_saved'), false);
    assert.equal(isValidEventName('add_added'), false);
    assert.equal(isValidEventName('click_clicked'), false);
  });

  it('accepts valid names', () => {
    assert.equal(isValidEventName('workflow_created'), true);
    assert.equal(isValidEventName('template_selected'), true);
    assert.equal(isValidEventName('step_config_saved'), true);
  });

  it('rejects non-business events', () => {
    assert.equal(isBusinessEvent('key_pressed'), false);
    assert.equal(isBusinessEvent('mouse_moved'), false);
    assert.equal(isBusinessEvent('scroll_started'), false);
  });

  it('converts PascalCase correctly', () => {
    assert.equal(toSnakeCaseFromPascalOrCamel('WorkflowEditor'), 'workflow_editor');
    assert.equal(toSnakeCaseFromPascalOrCamel('StepConfigPanel'), 'step_config_panel');
  });
});
```

Create `test/fixtures/empty/` with just a `package.json` (no source files).

**Step 3: Run and fix**

```bash
npm test
# Fix whatever breaks
```

### Day 3: Documentation

**Step 1: Rewrite README.md**

The current README still has old example output and the "do not run npm install -g logline" warning. Rewrite to:
- Quick start with `npx @logline/cli scan` (once published)
- Until published: clone + build + link flow
- Real example output from running on a test fixture
- Command reference table (all 10 commands)
- Supported frameworks list
- Configuration reference
- Link to docs/ for details

**Step 2: Create docs/ directory**

- `docs/tracking-plan-format.md` — Schema reference for tracking-plan.json. Emphasize machine-readability — include an "Agent Integration" section showing how to load it as LLM context.
- `docs/how-it-works.md` — Pipeline architecture with stage diagram. Explain the key insight: detect unnamed interactions first, then LLM names them with product context.
- `docs/configuration.md` — .logline/config.json reference, all options.
- `docs/conventions.md` — How the OTel-inspired semantic conventions work, how to add new domains.
- `docs/agent-integration.md` — Using tracking-plan.json as AI agent context. Show: load plan → use join paths for correlation → use expected sequences for anomaly detection → use metrics for automated analysis. Include GlassFlow + Logline + LangChain example.
- `docs/programmatic-api.md` — How to use @logline/cli as a library (for GitHub App, CI, etc.)

**Step 3: Add CONTRIBUTING.md**

- How to add a new framework detector (add a function to `04-detect-interactions.ts`)
- How to add a new analytics destination (add to `export.ts`)
- How to add a new convention domain (add YAML to `conventions/`)
- How to run tests
- Architecture overview

**Step 4: Add LICENSE (MIT)**

### Day 4: npm publish

**Step 1: Create npm org**

```bash
npm login
npm org create logline   # creates @logline scope
```

**Step 2: Pre-publish checks**

```bash
npm run build
npm test
npm pack --dry-run       # inspect what goes in the tarball
# Should include: dist/, conventions/, package.json, README.md, LICENSE
# Should NOT include: src/, test/, node_modules/, .logline/
```

**Step 3: Publish**

```bash
npm publish --access public
```

**Step 4: Verify global install**

```bash
npm install -g @logline/cli
logline --version        # should print 0.1.0
logline --help           # should list all commands
cd /tmp && mkdir test && cd test && npm init -y
mkdir -p src && echo 'const handleCreate = () => {}' > src/app.ts
logline init
logline scan --fast
```

**Step 5: Verify library import**

```bash
mkdir /tmp/test-lib && cd /tmp/test-lib && npm init -y
npm install @logline/cli
node -e "
  const { detectInteractions, readTrackingPlan } = require('@logline/cli');
  console.log('detectInteractions:', typeof detectInteractions);
  console.log('readTrackingPlan:', typeof readTrackingPlan);
"
# Both should print "function"
```

### Day 5: Tag release + announcement prep

- Tag `v0.1.0` on GitHub
- Write release notes
- Update README with `npx @logline/cli scan` now that it's published
- Draft a short Twitter/HN post (not posting yet — save for when GitHub App is ready)
- Create GitHub issues for known limitations / future work

---

## Month 2: GitHub App (Days 6-28)

### Architecture

```
logline-app/
├── .env.local                    # GitHub App credentials, Stripe keys
├── package.json                  # Depends on @logline/cli
├── vercel.json
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── webhooks/
│   │   │   │   └── github/route.ts     # POST — receives PR events
│   │   │   ├── install/route.ts         # GET — GitHub App install callback
│   │   │   ├── billing/
│   │   │   │   ├── checkout/route.ts    # POST — create Stripe checkout
│   │   │   │   └── webhook/route.ts     # POST — Stripe webhook
│   │   │   └── health/route.ts          # GET — status check
│   │   └── page.tsx                     # Landing page (minimal)
│   ├── lib/
│   │   ├── github.ts                    # Octokit setup, GitHub API helpers
│   │   ├── analysis/
│   │   │   ├── diff-parser.ts           # Parse PR diff into FileContent[]
│   │   │   ├── diff-analyzer.ts         # Run pipeline on diff-scoped files
│   │   │   └── suggestion-builder.ts    # Convert SynthesizedEvent → GitHub suggestion
│   │   ├── comments/
│   │   │   ├── review-builder.ts        # Build GitHub review with line comments
│   │   │   └── templates.ts             # Comment markdown templates
│   │   ├── feedback/
│   │   │   ├── store.ts                 # Store accept/reject per repo (KV or DB)
│   │   │   └── learner.ts              # Use feedback to improve future suggestions
│   │   ├── billing/
│   │   │   ├── stripe.ts               # Stripe client setup
│   │   │   └── entitlements.ts          # Check if repo/org has active subscription
│   │   └── tracking-plan-sync.ts        # Auto-update tracking plan on merge
│   └── types.ts                          # App-specific types (InstallationContext, etc.)
├── test/
│   ├── fixtures/                         # Sample diffs, PR payloads
│   └── analysis.test.ts
└── README.md
```

### Day 6-7: GitHub App registration + webhook scaffolding

**Step 1: Create the private repo**

```bash
mkdir logline-app && cd logline-app
npm init -y
npm install @logline/cli octokit @octokit/webhooks stripe next
npx create-next-app@latest . --typescript --app --tailwind --no-src-dir
# Or just scaffold manually since it's mostly API routes
```

**Step 2: Register a GitHub App**

Go to https://github.com/settings/apps/new:
- **Name:** Logline
- **Homepage:** https://github.com/MengyingLi/logline
- **Webhook URL:** https://your-app.vercel.app/api/webhooks/github (placeholder, update after deploy)
- **Webhook secret:** generate one, save it
- **Permissions:**
  - Repository: Contents (read), Pull requests (read & write), Checks (write)
  - Subscribe to events: Pull request, Pull request review
- **Where can this app be installed:** Any account
- Generate a private key, save it

Store in `.env.local`:
```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
GITHUB_WEBHOOK_SECRET=whsec_...
OPENAI_API_KEY=sk-...
```

**Step 3: Webhook handler**

Create `src/app/api/webhooks/github/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Webhooks } from '@octokit/webhooks';
import { handlePullRequest } from '@/lib/analysis/diff-analyzer';

const webhooks = new Webhooks({ secret: process.env.GITHUB_WEBHOOK_SECRET! });

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get('x-hub-signature-256') ?? '';

  // Verify webhook signature
  const isValid = await webhooks.verify(body, signature);
  if (!isValid) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });

  const event = req.headers.get('x-github-event');
  const payload = JSON.parse(body);

  if (event === 'pull_request') {
    const action = payload.action;
    if (action === 'opened' || action === 'synchronize') {
      // Don't await — respond immediately, process async
      handlePullRequest(payload).catch(console.error);
    }
  }

  return NextResponse.json({ ok: true });
}
```

**Step 4: Deploy to Vercel**

```bash
vercel --prod
# Update the webhook URL in GitHub App settings
```

**Step 5: Test webhook delivery**

Install the app on a test repo, open a PR, check Vercel logs for the webhook payload.

### Day 8-10: Diff-only analysis (the core value)

This is the key difference from the CLI. The CLI scans the entire codebase. The GitHub App only analyzes the diff — what changed in this PR.

**Step 1: Diff parser**

Create `src/lib/analysis/diff-parser.ts`:

```typescript
import type { FileContent } from '@logline/cli';

interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'removed';
  patch: string;           // the unified diff
  addedLines: number[];    // line numbers of added lines in the new version
  content?: string;        // full file content (fetched from GitHub)
}

/**
 * Parse a PR's changed files into FileContent[] that the pipeline can analyze.
 *
 * Strategy:
 * 1. Get list of changed files from GitHub API
 * 2. For each modified/added file, fetch full content from the PR branch
 * 3. Parse the diff to know which lines are new (these are what we suggest tracking for)
 * 4. Return FileContent[] scoped to changed files only
 */
export async function parsePRDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ files: FileContent[]; diffs: DiffFile[] }> {
  // GET /repos/{owner}/{repo}/pulls/{pull_number}/files
  // For each file: GET /repos/{owner}/{repo}/contents/{path}?ref={branch}
  // Return both the full files (for pipeline analysis) and the diffs (for line mapping)
}
```

**Step 2: Diff-scoped analysis**

Create `src/lib/analysis/diff-analyzer.ts`:

```typescript
import {
  detectInteractions,
  synthesizeEvents,
  analyzeProduct,
  readTrackingPlan,
  type RawInteraction,
  type SynthesizedEvent,
  type FileContent,
  type TrackingPlan,
} from '@logline/cli';

export async function handlePullRequest(payload: PullRequestPayload): Promise<void> {
  const { owner, repo, prNumber, branch } = extractPRInfo(payload);

  // 1. Check entitlement (paid subscriber?)
  // Skip for now, implement with Stripe later

  // 2. Fetch diff + file contents
  const octokit = await getInstallationOctokit(payload.installation.id);
  const { files, diffs } = await parsePRDiff(octokit, owner, repo, prNumber);

  // 3. Try to load existing tracking plan from the repo
  let trackingPlan: TrackingPlan | null = null;
  try {
    const planContent = await fetchFileFromRepo(octokit, owner, repo, branch, '.logline/tracking-plan.json');
    if (planContent) trackingPlan = JSON.parse(planContent);
  } catch { /* no tracking plan in repo */ }

  // 4. Run pipeline on diff-scoped files only
  const interactions = detectInteractions(files);

  // Filter to interactions that are in NEW lines only
  const newInteractions = filterToNewLines(interactions, diffs);

  if (newInteractions.length === 0) return; // nothing to suggest

  // 5. Check against existing tracking plan
  const existingEventNames = new Set([
    ...(trackingPlan?.events.map(e => e.name.toLowerCase()) ?? []),
  ]);
  const untracked = newInteractions.filter(i => {
    // Quick heuristic: if this interaction's likely event name already exists, skip it
    // Full check happens after synthesis
    return true; // for now, let synthesis handle dedup
  });

  // 6. Synthesize events
  const profile = trackingPlan?.product ?? await analyzeProduct({
    apiKey: process.env.OPENAI_API_KEY,
    files,
    existingEventNames: [...existingEventNames],
    entities: [],
  });

  const events = await synthesizeEvents(untracked, profile, {
    apiKey: process.env.OPENAI_API_KEY,
  });

  // Remove events that already exist in tracking plan
  const newEvents = events.filter(e => !existingEventNames.has(e.name.toLowerCase()));
  if (newEvents.length === 0) return;

  // 7. Build and post review
  await postReview(octokit, owner, repo, prNumber, newEvents, diffs);
}
```

**Step 3: Filter interactions to new lines**

```typescript
function filterToNewLines(interactions: RawInteraction[], diffs: DiffFile[]): RawInteraction[] {
  return interactions.filter(interaction => {
    const diff = diffs.find(d => d.path === interaction.file);
    if (!diff) return false;
    // Only keep interactions where the handler is on a newly added line
    return diff.addedLines.includes(interaction.line);
  });
}
```

This is crucial — we only suggest tracking for code that was ADDED in this PR, not for the entire file. A developer adding a new handler function should get a suggestion; a developer fixing a typo in an existing handler should not.

### Day 11-13: PR comments — line-level suggestions

**Step 1: Build GitHub review with suggestions**

Create `src/lib/comments/review-builder.ts`:

```typescript
import { generateTrackingCode } from '@logline/cli';

interface ReviewComment {
  path: string;
  line: number;         // line in the diff (right side)
  body: string;         // markdown with suggestion
}

export function buildReview(
  events: SynthesizedEvent[],
  diffs: DiffFile[],
  trackingPlan: TrackingPlan | null,
): { summary: string; comments: ReviewComment[] } {
  const comments: ReviewComment[] = [];

  for (const event of events) {
    const diff = diffs.find(d => d.path === event.location.file);
    if (!diff) continue;

    // Find the diff line number for the event's location
    const diffLine = mapSourceLineToDiffLine(event.location.line, diff);
    if (!diffLine) continue;

    // Generate the tracking code
    const trackingCode = generateTrackingCode(/* ... */);

    // Build a GitHub "suggested change" comment
    const body = buildSuggestionComment(event, trackingCode);
    comments.push({ path: event.location.file, line: diffLine, body });
  }

  const summary = buildSummaryComment(events, trackingPlan);
  return { summary, comments };
}
```

**Step 2: Suggestion comment format**

```typescript
function buildSuggestionComment(event: SynthesizedEvent, trackingCode: string): string {
  return `### 📊 Logline: Track \`${event.name}\`

${event.description}

**Priority:** ${event.priority}
${event.includes?.length ? `**Groups:** ${event.includes.join(', ')}` : ''}

\`\`\`suggestion
${trackingCode}
\`\`\`

<details>
<summary>Why track this?</summary>

This ${event.priority}-priority event enables measuring ${event.name.replace(/_/g, ' ')} in your analytics.
${event.includes?.length ? `It groups these related interactions: ${event.includes.join(', ')}.` : ''}

</details>

---
*🤖 [Logline](https://github.com/MengyingLi/logline) — auto-instrument product analytics*`;
}
```

The `\`\`\`suggestion` block is GitHub's native format — developers can click "Apply suggestion" to commit the change directly from the PR. This is the key UX advantage over a generic bot comment.

**Step 3: Post the review via GitHub API**

```typescript
async function postReview(
  octokit: Octokit,
  owner: string, repo: string, prNumber: number,
  events: SynthesizedEvent[], diffs: DiffFile[]
): Promise<void> {
  const { summary, comments } = buildReview(events, diffs, null);

  // Post as a review (not individual comments) so they appear as a batch
  await octokit.pulls.createReview({
    owner, repo, pull_number: prNumber,
    event: 'COMMENT',  // not APPROVE or REQUEST_CHANGES
    body: summary,
    comments: comments.map(c => ({
      path: c.path,
      line: c.line,
      body: c.body,
    })),
  });
}
```

**Step 4: Summary comment**

The first comment in the review is a summary:

```markdown
## 📊 Logline found 3 events to track in this PR

| Event | File | Priority |
|-------|------|----------|
| `workflow_created` | src/handlers/workflow.ts | 🔴 High |
| `step_configured` | src/components/StepPanel.tsx | 🟡 Medium |
| `template_selected` | src/pages/Create.tsx | 🟡 Medium |

Each suggestion below uses GitHub's native format — click **Apply suggestion** to add tracking code.

**New to Logline?** Run `npx @logline/cli init` in your repo for a full tracking plan.
```

### Day 14-16: Feedback loop

When a developer accepts or rejects a Logline suggestion, we should learn from it.

**Step 1: Listen for review comment reactions**

GitHub doesn't have a native "accepted/rejected suggestion" webhook. But we can detect:
- **Accepted:** A commit appears on the PR branch that includes `Logline:` in the code (our generated tracking code has `// Logline: event_name`)
- **Rejected:** The review comment gets a 👎 reaction, or the comment is dismissed/resolved without applying

Listen for `pull_request.synchronize` (new commits) and `pull_request_review_comment` events.

**Step 2: Store feedback**

Use Vercel KV (Redis) or a simple JSON store per repo:

```typescript
interface RepoFeedback {
  repoFullName: string;           // "MengyingLi/some-project"
  accepted: AcceptedEvent[];
  rejected: RejectedEvent[];
}

interface AcceptedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  timestamp: string;
}

interface RejectedEvent {
  eventName: string;
  file: string;
  prNumber: number;
  reason?: string;               // from comment
  timestamp: string;
}
```

**Step 3: Use feedback in future analysis**

Before posting suggestions:
- Check if this event name was previously rejected for this repo → skip it
- Check if similar events were consistently accepted → boost priority
- Track acceptance rate per event pattern to calibrate confidence thresholds

### Day 17-18: Tracking plan auto-sync

When a PR merges with Logline suggestions applied:

**Step 1: Listen for `pull_request.closed` with `merged: true`**

**Step 2: Check if the merged PR had Logline suggestions**

Look for commits that include `// Logline:` tracking code.

**Step 3: Update tracking plan**

- If `.logline/tracking-plan.json` exists in the repo, open a follow-up PR that updates it:
  - Move applied events from `suggested` → `implemented`
  - Add any new events found in the merge
- If no tracking plan exists, create one:
  - Open a PR titled "chore: Add Logline tracking plan"
  - Includes the generated tracking-plan.json

**Step 4: PR for tracking plan update**

```typescript
async function syncTrackingPlan(
  octokit: Octokit,
  owner: string, repo: string,
  baseBranch: string,
  implementedEvents: string[]
): Promise<void> {
  // 1. Fetch current tracking plan from repo
  // 2. Update event statuses
  // 3. Create branch: logline/sync-tracking-plan-{timestamp}
  // 4. Commit updated tracking-plan.json
  // 5. Open PR
}
```

### Day 19-21: Billing (Stripe)

**Step 1: Stripe setup**

- Create a Stripe product: "Logline GitHub App"
- Create a price: $5/month
- Set up Stripe webhook endpoint

**Step 2: Install flow**

When someone installs the GitHub App:
1. Redirect to install callback URL
2. Check if they have a Stripe subscription
3. If not → redirect to Stripe checkout
4. If yes → activate for their repos

**Step 3: Entitlement check**

Before analyzing a PR:
```typescript
async function checkEntitlement(installationId: number, repoFullName: string): Promise<boolean> {
  // Look up the installation → GitHub org/user
  // Check Stripe for active subscription for that org/user
  // Return true if entitled, false if not
  // If not entitled, post a gentle comment: "Logline analysis requires a subscription. Visit..."
}
```

**Step 4: Stripe webhook**

Handle `customer.subscription.created`, `customer.subscription.deleted`, `invoice.payment_failed`.

### Day 22-24: Integration testing + polish

- Test the full flow: install app → open PR with new handler → get suggestion → apply → merge → tracking plan updated
- Test billing: install without subscription → redirect to checkout → pay → analysis starts
- Test edge cases:
  - PR with no code changes (just README)
  - PR with 100+ changed files (don't overload with suggestions)
  - PR that modifies existing tracking code (don't suggest re-tracking)
  - Monorepo with multiple packages
- Rate limiting: don't analyze the same PR commit twice
- Error handling: OpenAI timeout, GitHub API failure, missing permissions

### Day 25-26: Landing page + GitHub Marketplace

**Step 1: Simple landing page**

At the Vercel domain (or custom domain). One page:
- Hero: "Auto-instrument product analytics on every PR"
- Terminal GIF showing `logline scan` output
- How it works: 3-step diagram (PR opened → Logline suggests → click Apply)
- Pricing: Free CLI, $5/mo GitHub App
- Install button → GitHub App install flow

**Step 2: GitHub Marketplace listing**

List the app on GitHub Marketplace with the $5/mo plan.

### Day 27-28: Launch

- Publish GitHub App
- Post on Twitter/X
- Post on Hacker News: "Show HN: Logline — the OTel for product analytics"
- Post on relevant subreddits (r/analytics, r/devtools)
- Install on your own projects as showcase

---

## Success Criteria (End of Month 2)

A developer should be able to:

1. `npx @logline/cli scan` → high-quality scan results (free)
2. Install the GitHub App on their repo → starts analyzing PRs
3. Open a PR with a new handler → get inline suggestions with Apply button
4. Click Apply → tracking code committed to their branch
5. Merge → tracking plan auto-updated
6. Pay $5/mo → continues working on private repos

The data flywheel:
```
CLI generates tracking plan → commits to repo
GitHub App reads tracking plan → knows what's already tracked
New PR → App analyzes diff against plan → suggests only what's missing
Developer accepts/rejects → feedback stored
Next PR → better suggestions
Merge → tracking plan updated → cycle continues
```