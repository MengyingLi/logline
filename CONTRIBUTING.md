# Contributing to Logline

Thanks for helping improve Logline.

## Dev Setup

```bash
git clone https://github.com/MengyingLi/logline
cd logline
npm install
npm run build
npm test
```

## Architecture Overview

- CLI entrypoint: `src/cli.ts`
- Programmatic API entrypoint: `src/index.ts`
- Pipeline stages: `src/lib/pipeline/`
- Context extraction: `src/lib/context/`
- Utilities: `src/lib/utils/`
- Commands: `src/commands/`
- Conventions: `conventions/*.yml`

## Add a New Framework Detector

1. Edit `src/lib/pipeline/04-detect-interactions.ts`.
2. Add a focused detector function for the new framework pattern.
3. Add it to `detectInteractions(...)`.
4. Keep output in `RawInteraction[]`.
5. Add/adjust fixture coverage in `test/fixtures/*` and tests in `test/scan.test.js`.

## Add a New Export Destination

1. Edit `src/commands/export.ts`.
2. Add a new formatter function that maps tracking-plan fields into destination schema.
3. Wire it into the format switch.
4. Ensure unsupported formats fail with clear errors.

## Add a New Convention Domain

1. Add YAML file(s) under `conventions/`.
2. Follow the same schema used by existing convention files.
3. Validate with `logline scan` on a fixture that exercises that domain.

## Testing

- Run all tests: `npm test`
- Run build checks: `npm run build`
- Recommended before PR: `npm run build && npm test`

