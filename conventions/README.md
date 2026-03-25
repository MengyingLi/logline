# Logline Semantic Conventions

Conventions define standard event names, required/optional attributes, and lifecycle patterns for product analytics (inspired by OpenTelemetry semantic conventions).

## Naming Rules

- **Event names:** `snake_case`. Format: `{object}_{action}_{lifecycle}`.
- **Lifecycle suffixes:** `attempt` | `success` | `fail` | `start` | `complete` | `skip`.
- **Attribute names:** `snake_case`.
- **Enum values:** `snake_case`.
- **No PII** in any attribute values.

## Adding a Convention

1. Create a directory under `conventions/{domain}/` (e.g. `conventions/onboarding/`).
2. Add a YAML file (e.g. `events.yaml`) that follows the schema:

```yaml
domain: my_domain
description: Optional description of the domain.
status: stable   # stable | experimental | deprecated
version: "1.0"

events:
  - name: object_action_lifecycle
    lifecycle: attempt | success | fail | start | complete | skip
    description: When to fire this event.
    attributes:
      required:
        - name: attr_name
          type: string | number | boolean | enum | array
          values: []        # for enum
          items: string     # for array element type
          description: What this attribute means.
      optional: []
```

3. Implement matching heuristics in `src/conventions/matcher.ts` so the scanner knows when to apply this domain (e.g. by file path or code patterns).

## Bundled Conventions

- **onboarding** — Signup, email verification, and onboarding step progression.
