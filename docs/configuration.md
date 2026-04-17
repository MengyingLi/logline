# Configuration

Logline reads `.logline/config.json` in your project root. All fields are optional — Logline works with zero configuration.

## Full schema

```json
{
  "eventGranularity": "business",
  "scan": {
    "include": ["src/**/*.{ts,tsx,js,jsx}"],
    "exclude": [
      "**/*.test.*",
      "**/*.spec.*",
      "**/node_modules/**",
      "dist/**",
      ".next/**"
    ]
  },
  "tracking": {
    "destination": "segment",
    "debug": false
  }
}
```

## Fields

### `eventGranularity`

Controls how interactions are grouped into events.

| Value | Behavior |
|-------|----------|
| `"business"` (default) | Group related interactions into business events (`mapping_added` + `trigger_selected` → `workflow_edited`) |
| `"granular"` | One event per interaction (same as `--granular` flag) |

### `scan.include`

Glob patterns for files to include. Default: `["src/**/*.{ts,tsx,js,jsx}"]`.

```json
{
  "scan": {
    "include": [
      "src/**/*.{ts,tsx}",
      "app/**/*.{ts,tsx}",
      "pages/**/*.{ts,tsx}"
    ]
  }
}
```

### `scan.exclude`

Glob patterns for files to exclude. These are merged with Logline's built-in exclusions (`node_modules`, `dist`, `.next`, etc.).

```json
{
  "scan": {
    "exclude": [
      "**/*.test.*",
      "**/*.stories.*",
      "src/mocks/**"
    ]
  }
}
```

### `logging`

Configure how Logline generates structured log statements for `operation`, `error`, and `state_change` signals. Optional — if omitted, a console-based stub is used.

```json
{
  "logging": {
    "destination": "pino",
    "importPath": "@/lib/logger",
    "instanceName": "logger"
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `destination` | `'pino' \| 'winston' \| 'console'` | `'console'` | Logger library. Determines the generated `src/lib/logger.ts` template when `logline pr` creates one. |
| `importPath` | string | `'@/lib/logger'` | Import path used in generated code: `import { logger } from '@/lib/logger'`. |
| `instanceName` | string | `'logger'` | Variable name for the logger. Generates `logger.info(...)`, `logger.error(...)`. |

`logline pr` creates `src/lib/logger.ts` automatically when operational signals are found and the file doesn't already exist.

### `tracking.destination`

Hints to Logline which analytics library is already in use, affecting generated `track()` calls.

| Value | Generated import |
|-------|-----------------|
| `"segment"` | Uses `analytics.track()` via `src/lib/analytics.ts` |
| `"posthog"` | Uses `posthog.capture()` |
| `"mixpanel"` | Uses `mixpanel.track()` |
| `"custom"` (default) | Generates a generic `track()` stub |

### `tracking.debug`

When `true`, the generated `track()` stub logs to console in all environments (not just development).

## Initialization

`logline init` creates `.logline/config.json` with sensible defaults for your project. You can also create it manually.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | No | Enables LLM-powered event synthesis. Without it, `--fast` mode is used automatically. |

## Per-command overrides

Most config values can be overridden at the CLI level:

```bash
logline scan --fast          # override eventGranularity for this run
logline scan --granular      # force granular mode
logline scan --verbose       # verbose output
logline status --cwd ./app   # run against a different directory
```
