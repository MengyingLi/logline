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
