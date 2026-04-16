# PLAN-MONTH3.md — Fix, Publish, Structured Logging

> **How to use:** Tell Claude Code \`Read PLAN-MONTH3.md and execute Day X\`

---

## What we're building

1. **Days 1-3:** Fix issues found in audit, add missing unit tests, publish to npm
2. **Days 4-7:** Add \`signalType\` router to the tracking plan + detect operational patterns
3. **Days 8-12:** Code generation for logs, config update, end-to-end testing, publish patch

---

## Current State (after Month 2)

7,042 lines, 43 files, 11 commands (init, scan, spec, pr, status, approve, reject, metrics, context, export, doctor). Compiles cleanly. \`src/index.ts\` exports 25 symbols. Tests exist (7 tests, all pass when run correctly). Docs exist (7 files). README updated. MIT license. CONTRIBUTING.md exists.

### Issues Found in Audit

**Critical (blocks publish):**
1. **Test script broken.** \`"test": "node --test test/"\` fails with MODULE_NOT_FOUND. Fix: \`"test": "node --test test/*.test.js"\`
2. **Cache files committed in fixtures.** \`test/fixtures/{nextjs-saas,express-api,react-spa}/.logline/cache/scan.json\` are committed to git. Tests hit cache instead of actually scanning — this masks bugs silently. Delete and add \`test/fixtures/**/.logline/\` to \`.gitignore\`.

**Important (should fix before publish):**
3. **No unit tests for core modules.** The 4 most complex files have zero direct test coverage:
   - \`scope-analyzer.ts\` (406 lines) — no tests
   - \`04-detect-interactions.ts\` (542 lines) — no tests
   - \`event-name.ts\` (85 lines) — no tests
   - \`actor-object-extractor.ts\` (324 lines) — no tests
4. **\`prepublishOnly\` will fail** because of the broken test script.

---

## Day 1 — Fix Bugs + Clean Fixtures

### Step 1: Fix the test script

In \`package.json\`, change:
\`\`\`json
"test": "node --test test/*.test.js"
\`\`\`

Verify: \`npm test\` should now run all 7 tests and pass.

### Step 2: Delete committed cache files

\`\`\`bash
rm -rf test/fixtures/nextjs-saas/.logline/
rm -rf test/fixtures/express-api/.logline/
rm -rf test/fixtures/react-spa/.logline/
\`\`\`

These get generated during test runs. They cause tests to hit cache and mask real bugs.

### Step 3: Add fixture caches to .gitignore

Add to \`.gitignore\`:
\`\`\`
test/fixtures/**/.logline/
\`\`\`

### Step 4: Re-run tests WITHOUT cache

\`\`\`bash
npm run build && npm test
\`\`\`

If any tests fail now that they can't hit cache, that reveals real bugs. Fix them.

### Step 5: Check no cache leaks back

The scan.test.js runs scanCommand on fixture directories directly (not tmp copies). This means it creates \`.logline/cache/\` inside the fixture dirs. After tests:
\`\`\`bash
ls test/fixtures/nextjs-saas/.logline/ 2>/dev/null && echo "LEAKED" || echo "CLEAN"
\`\`\`

If cache leaks, either add cleanup after tests or modify scan.test.js to copy fixtures to tmp first (like the e2e test already does).

### Verification
\`\`\`bash
npm run build && npm test            # all pass
ls test/fixtures/*/.logline/ 2>/dev/null   # should be empty
\`\`\`

---

## Day 2 — Unit Tests for Core Modules

### Step 1: Event name tests — \`test/event-name.test.js\`

\`\`\`javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidEventName, isBusinessEvent, toSnakeCaseFromPascalOrCamel, extractLikelyObjectFromPath } = require('../dist/lib/utils/event-name.js');

test('rejects garbage names', () => {
  for (const g of ['save_saved','add_added','click_clicked','delete_deleted','update_updated','remove_removed']) {
    assert.equal(isValidEventName(g), false, \`should reject "\${g}"\`);
  }
});

test('rejects too-short object', () => { assert.equal(isValidEventName('ab_created'), false); });
test('rejects single-word', () => { assert.equal(isValidEventName('clicked'), false); });

test('accepts valid names', () => {
  for (const v of ['workflow_created','template_selected','step_config_saved','user_signed_up']) {
    assert.equal(isValidEventName(v), true, \`should accept "\${v}"\`);
  }
});

test('filters non-business events', () => {
  for (const nb of ['key_pressed','mouse_moved','scroll_started','focus_gained','drag_started']) {
    assert.equal(isBusinessEvent(nb), false, \`should filter "\${nb}"\`);
  }
  assert.equal(isBusinessEvent('workflow_created'), true);
});

test('converts PascalCase', () => {
  assert.equal(toSnakeCaseFromPascalOrCamel('WorkflowEditor'), 'workflow_editor');
  assert.equal(toSnakeCaseFromPascalOrCamel('StepConfigPanel'), 'step_config_panel');
});

test('extracts object from path', () => {
  assert.ok(extractLikelyObjectFromPath('src/components/WorkflowEditor.tsx'));
  assert.equal(extractLikelyObjectFromPath('src/pages/index.tsx'), null);
});
\`\`\`

### Step 2: Interaction detection tests — \`test/detect-interactions.test.js\`

\`\`\`javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { detectInteractions } = require('../dist/lib/pipeline/04-detect-interactions.js');

test('detects onClick handlers', () => {
  const files = [{ path: 'src/App.tsx', content: \`
    function App() {
      const handleCreateWorkflow = () => { console.log('create'); };
      return <button onClick={handleCreateWorkflow}>Create</button>;
    }\` }];
  const r = detectInteractions(files);
  assert.ok(r.length > 0);
  assert.ok(r.some(i => i.type === 'click_handler'));
});

test('detects form submits', () => {
  const files = [{ path: 'src/Form.tsx', content: \`
    function Form() {
      const handleSubmit = (e) => { e.preventDefault(); };
      return <form onSubmit={handleSubmit}><button>Go</button></form>;
    }\` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'form_submit'));
});

test('detects Express routes', () => {
  const files = [{ path: 'src/routes.ts', content: \`
    router.post('/api/tasks', async (req, res) => { res.json({}); });
    router.delete('/api/tasks/:id', async (req, res) => { res.json({}); });
  \` }];
  assert.ok(detectInteractions(files).filter(i => i.type === 'route_handler').length >= 2);
});

test('detects Next.js App Router handlers', () => {
  const files = [{ path: 'src/app/api/users/route.ts', content: \`
    export async function POST(request: Request) {
      return new Response(JSON.stringify({ ok: true }));
    }\` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'route_handler'));
});

test('detects Prisma mutations', () => {
  const files = [{ path: 'src/service.ts', content: \`
    await prisma.workflow.create({ data: { name: 'test' } });
    await prisma.task.delete({ where: { id: taskId } });
  \` }];
  assert.ok(detectInteractions(files).filter(i => i.type === 'mutation').length >= 2);
});

test('detects Supabase mutations', () => {
  const files = [{ path: 'src/db.ts', content: \`await supabase.from('workflows').insert({ name: 'test' });\` }];
  assert.ok(detectInteractions(files).some(i => i.type === 'mutation'));
});

test('ignores node_modules and dist', () => {
  const files = [
    { path: 'node_modules/lib/index.ts', content: 'const handleClick = () => {};' },
    { path: 'dist/app.js', content: 'const handleSubmit = () => {};' },
  ];
  assert.equal(detectInteractions(files).length, 0);
});

test('deduplicates same handler', () => {
  const files = [{ path: 'src/App.tsx', content: \`
    const handleSave = () => { console.log('save'); };
    return <button onClick={handleSave}>Save</button>;
  \` }];
  const saves = detectInteractions(files).filter(i => (i.functionName || '').includes('Save') || (i.functionName || '').includes('handleSave'));
  assert.ok(saves.length <= 1, \`should dedupe, got \${saves.length}\`);
});
\`\`\`

### Step 3: Scope analyzer tests — \`test/scope-analyzer.test.js\`

\`\`\`javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeScope } = require('../dist/lib/utils/scope-analyzer.js');

test('finds useState variables', () => {
  const code = 'function App() {\\n  const [workflow, setWorkflow] = useState({ id: "w1" });\\n  return <div />;\\n}';
  const scope = analyzeScope(code, 3);
  assert.ok(scope.map(v => v.name).includes('workflow'), \`got: \${scope.map(v=>v.name)}\`);
});

test('finds function parameters', () => {
  const code = 'const handleSubmit = (workflow: Workflow, index: number) => {\\n  console.log(workflow.id);\\n};';
  const scope = analyzeScope(code, 2);
  assert.ok(scope.map(v => v.name).includes('workflow'), \`got: \${scope.map(v=>v.name)}\`);
});

test('finds destructured props', () => {
  const code = 'function Component({ user, onSave }: Props) {\\n  return <button onClick={() => onSave(user.id)}>Save</button>;\\n}';
  const scope = analyzeScope(code, 2);
  assert.ok(scope.map(v => v.name).includes('user'), \`got: \${scope.map(v=>v.name)}\`);
});

test('returns array for out-of-range line', () => {
  assert.ok(Array.isArray(analyzeScope('const x = 1;', 999)));
});
\`\`\`

### Step 4: Build and run all tests

\`\`\`bash
npm run build
npm test   # existing 7 + new unit tests should all pass
\`\`\`

---

## Day 3 — npm Publish

### Step 1: Pre-publish checks

\`\`\`bash
npm run build && npm test               # all pass
npm pack --dry-run                      # check tarball contents
ls dist/index.js dist/index.d.ts       # both exist
node -e "const l = require('./dist/index.js'); console.log(Object.keys(l).length + ' exports')"
\`\`\`

### Step 2: Publish

\`\`\`bash
npm login
npm org create logline     # if org doesn't exist
npm publish --access public
\`\`\`

If \`@logline\` org is taken, use \`@logline-dev/cli\` or your own scope.

### Step 3: Verify

\`\`\`bash
npm install -g @logline/cli && logline --version && logline --help && logline doctor
cd /tmp && mkdir test-import && cd test-import && npm init -y && npm install @logline/cli
node -e "const { detectInteractions, readTrackingPlan, scanCommand } = require('@logline/cli'); console.log(typeof detectInteractions, typeof readTrackingPlan, typeof scanCommand)"
\`\`\`

### Step 4: Tag + release

\`\`\`bash
git tag v0.1.0 && git push --tags
\`\`\`

Create GitHub Release. Update README to use \`npx @logline/cli scan\`.

---

## Day 4 — Add \`signalType\` to the Type System

### What it is

One field that routes signals to the right destination and the right code generation:

\`\`\`
signalType: "action"        → track()         → analytics (Segment, PostHog)
signalType: "operation"     → logger.info()   → logging (Datadog, Grafana)
signalType: "state_change"  → BOTH            → analytics + logging
signalType: "error"         → logger.error()  → logging + alerts
\`\`\`

### Tasks

1. Add \`SignalType\` type to \`src/lib/types.ts\`:
   \`\`\`typescript
   export type SignalType = 'action' | 'operation' | 'state_change' | 'error';
   \`\`\`

2. Add \`signalType: SignalType\` to \`TrackingPlanEvent\` in types.ts

3. Add \`signalType: import('../types').SignalType\` to \`SynthesizedEvent\` in pipeline/types.ts

4. Add \`signalType?: import('../types').SignalType\` to \`TrackingGap\` in tracking-gap-detector.ts

5. Extend \`RawInteraction.type\` union with: \`'error_boundary' | 'api_call' | 'retry_logic' | 'job_handler'\`

6. Create \`inferSignalType()\` in \`05-synthesize-events.ts\`:
   - click_handler, form_submit, toggle → \`'action'\`
   - route_handler, mutation → \`'action'\` (most user-triggered)
   - lifecycle, state_change → \`'state_change'\`
   - error_boundary → \`'error'\`
   - api_call, retry_logic, job_handler → \`'operation'\`

7. Populate \`signalType\` through the pipeline: synthesize → scan (synthesizedToGap) → spec (gap to TrackingPlanEvent)

8. Default to \`'action'\` everywhere for backward compatibility. Existing tracking plans without \`signalType\` should still load.

9. Fix all TypeScript errors from the new required field.

\`\`\`bash
npx tsc --noEmit && npm test
\`\`\`

---

## Day 5-6 — Detect Operational Patterns

Extend \`src/lib/pipeline/04-detect-interactions.ts\` with four new detectors.

### \`detectErrorBoundaries\` — try/catch blocks, .catch() chains
- type: \`'error_boundary'\`, confidence: 0.7
- Find enclosing function name via backward walk
- Extract entities from surrounding code context

### \`detectAPICalls\` — outbound HTTP requests
- Patterns: \`fetch(...)\`, \`axios.get/post/put/delete(...)\`, \`*Client.request(...)\`
- type: \`'api_call'\`, confidence: 0.6
- Extract entities from URL path segments

### \`detectRetryLogic\` — retry/backoff patterns
- Patterns: for/while loops with retry/attempt variables, \`withRetry()\`, \`backoff()\`
- type: \`'retry_logic'\`, confidence: 0.75
- Deduplicate by line (retry keyword might match multiple patterns)

### \`detectJobHandlers\` — background job processing
- Patterns: \`queue.process('name', ...)\`, \`cron.schedule(...)\`, \`createFunction(...)\`
- type: \`'job_handler'\`, confidence: 0.85

### Helper functions needed
- \`findEnclosingFunction(lines, lineNumber)\` — walk backward to find function/const name
- \`extractEntitiesFromContext(context)\` — find PascalCase words, filter out builtins (Promise, Error, etc.)
- \`extractEntitiesFromURL(url)\` — parse URL path segments into entity names
- \`deduplicateByLine(interactions)\` — same file + same line = keep one

### Wire all four into \`detectInteractions()\`

### Add tests for new detectors in \`test/detect-interactions.test.js\`:
- try/catch → error_boundary
- fetch/axios → api_call
- retry loop → retry_logic

\`\`\`bash
npx tsc --noEmit && npm test
logline scan --fast   # should now show operational detections
\`\`\`

---

## Day 7 — Update LLM Synthesis + Scan Output

### LLM prompt update in \`05-synthesize-events.ts\`

Add to the prompt:
- Signal type instructions (action, operation, state_change, error)
- Naming conventions: \`object_action\` for actions, \`object.operation.detail\` for operations
- Parse \`signalType\` from LLM response

### Scan output update in \`cli.ts\`

Group events by signal type in \`printScanResult\`:
\`\`\`
📊 Analytics (→ Segment/PostHog):     ✗ workflow_created ...
🔧 Operations (→ logging):            ✗ workflow.step.executed ...
🔄 State transitions (→ both):        ✗ workflow.state_transition ...
🔴 Errors (→ logging):                ✗ workflow.step.failed ...
\`\`\`

---

## Day 8-9 — Code Generation for Logs

### Config extension
Add \`logging: { destination, importPath, instanceName }\` to LoglineConfig. Default: console logger.

### Code generator update
\`generateTrackingCode\` accepts \`signalType\` option:
- \`action\` → \`track('name', {...})\`
- \`operation\` → \`logger.info('name', {...})\`
- \`state_change\` → both track() and logger.info()
- \`error\` → \`logger.error('name', {...})\`

### PR command update
- Read logging config, pass to code generator
- Handle dual imports (analytics + logger) for \`state_change\` events
- Add \`ensureLoggerModule\` (generates \`src/lib/logger.ts\` with pino/winston/console template)

---

## Day 10-11 — Testing + Polish

### Signal type tests (\`test/signal-type.test.js\`)
- action → track()
- error → logger.error()
- state_change → both
- scan output includes signalType

### Operational fixture (\`test/fixtures/with-operations/\`)
- File with try/catch, fetch calls, retry logic
- Verify scan detects all three operational pattern types

### End-to-end smoke test
\`\`\`bash
logline init && logline scan --fast && logline spec
cat .logline/tracking-plan.json | grep signalType
logline pr --dry-run   # track() for actions, logger.error() for errors
\`\`\`

---

## Day 12 — Docs, Publish Patch, Announce

### Update docs
- tracking-plan-format.md → add signalType
- configuration.md → add logging config
- agent-integration.md → show agents using signalType to correlate analytics + logs

### Update README
Add signal types table.

### Publish
\`\`\`bash
npm version patch && npm run build && npm test && npm publish
\`\`\`

---

## Verification (End of Month 3)

\`\`\`bash
npx tsc --noEmit                    # compiles
npm test                            # all tests pass (unit + integration + e2e)
logline scan --fast                 # shows signal types grouped in output
logline scan --json | jq '.gaps[0].signalType'
logline spec && cat .logline/tracking-plan.json | jq '.events[] | {name, signalType}'
logline pr --dry-run                # track() for actions, logger.error() for errors
\`\`\`