# Programmatic API (`logline-cli`)

`logline-cli` can be used as a library by GitHub Apps, CI jobs, and internal tools.

## Install

```bash
npm install logline-cli
```

## Example: Run a Scan

```ts
import { scanCommand } from 'logline-cli';

const result = await scanCommand({
  cwd: '/path/to/repo',
  fast: true,
  json: true,
});

console.log(result.gaps.map((g) => g.suggestedEvent));
```

## Example: Use Pipeline Stages Directly

```ts
import {
  loadCodebaseFiles,
  detectInteractions,
  synthesizeEvents,
  extractContext,
} from 'logline-cli';

const files = await loadCodebaseFiles('/path/to/repo');
const interactions = detectInteractions(files);
const context = extractContext(files);
const events = await synthesizeEvents(interactions, {
  mission: 'unknown',
  valueProposition: 'unknown',
  businessGoals: [],
  userPersonas: [],
  keyMetrics: [],
  confidence: 0,
}, { fast: true });
```

## Useful Exports

- Commands: `scanCommand`, `specCommand`, `metricsCommand`, `contextCommand`
- Pipeline: `detectInteractions`, `synthesizeEvents`, `findBestLocation`, `inferEventProperties`
- Context: `extractTrackingPlanContext`, `detectLifecycles`, `generateMetrics`, `generateExpectedSequences`
- Utilities: `readTrackingPlan`, `writeTrackingPlan`, `mergeTrackingPlan`, `generateTrackingCode`, `analyzeScope`

