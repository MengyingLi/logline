# Conventions

Logline supports semantic conventions via YAML files in the `conventions/` directory.

## Why Conventions Exist

Conventions provide a domain-aware baseline for event naming and required attributes.
They make output more consistent and easier to integrate with downstream tools.

## File Layout

- Domain convention files live in `conventions/*.yml`.
- The CLI loads and scores applicable conventions during scan.

## Typical Fields

Convention definitions typically include:

- Domain metadata
- Event name patterns
- Required attributes
- Optional attributes
- Reasoning hints

## How Coverage Works

When conventions apply, `logline scan` reports:

- matched convention events
- missing convention events
- required attributes missing in tracked events

This output appears under convention coverage in scan results.

## Add a New Domain

1. Create a new YAML file in `conventions/`.
2. Define event patterns and required attributes.
3. Run `logline scan` against a fixture/project in that domain.
4. Validate convention coverage output and adjust schema as needed.

