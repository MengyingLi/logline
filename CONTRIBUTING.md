# Contributing to Logline

Thanks for your interest. There are two high-value contribution areas — convention domains and the synthesis prompt — plus the usual bug fixes and features.

## Development Setup

```bash
git clone https://github.com/MengyingLi/logline
cd logline
npm install
npm run build
npm link

# Verify the install
logline doctor
```

Run tests before opening a PR:

```bash
npm test
```

## Project Structure

```
src/lib/pipeline/          # The scan pipeline (steps 01–07)
  04-detect-interactions.ts  # Finds raw interactions in code
  05-synthesize-events.ts    # Names interactions as analytics events
src/commands/              # CLI command implementations (scan, spec, apply, …)
src/conventions/           # Domain-matching and coverage logic
  matcher.ts               # Detects which domains apply to a codebase
  coverage.ts              # Checks event coverage against loaded conventions
conventions/               # Event contracts, one directory per domain
  billing/events.yaml
  onboarding/events.yaml
  search/events.yaml
  collaboration/events.yaml
apps/logline-app/          # The Logline Cloud dashboard (Next.js)
```

---

## Contribution Area 1: Convention Domains

Convention domains define which events *matter* for a specific industry vertical. When Logline detects a domain in a codebase, it checks coverage and reports gaps. **This is the highest-value contribution path.** Adding a new domain (e.g. `marketplace`, `devtools`, `healthcare`) immediately benefits every project in that space.

### Adding a New Domain

**Step 1 — Create the event contract**

```
conventions/mydomain/events.yaml
```

Use `conventions/billing/events.yaml` as your reference template. Define 5–10 events with `required` attributes for each.

```yaml
domain: mydomain
description: >
  One or two sentences describing what this domain covers.
status: stable
version: "1.0"

events:
  - name: object_action           # snake_case, object_action format
    lifecycle: success            # attempt | success | fail | start | complete | skip
    description: >
      When exactly to fire this event, from the user's perspective.
    attributes:
      required:
        - name: object_id
          type: string
          description: Identifier of the affected object.
      optional:
        - name: some_property
          type: string
          description: Optional context.
```

**Step 2 — Add detection signals to `src/conventions/matcher.ts`**

Add an entry to the `SIGNALS` object so Logline can recognize this domain in a codebase:

```typescript
mydomain: {
  paths: ['mydomain', 'relevant-path'],        // file path fragments
  components: ['MyDomainComponent'],           // JSX component names
  patterns: [/relevantPattern|otherThing/i],  // code patterns
},
```

A domain activates only when at least 2 distinct signal types match, preventing false positives.

**Step 3 — Add human-readable missing reasons to `src/conventions/coverage.ts`**

In the `missingReason` function, add cases for your new events so gap reports are actionable:

```typescript
if (eventName === 'listing_published') return 'Listing publish handler not instrumented';
if (domain === 'mydomain') return 'Marketplace event not instrumented';
```

**Step 4 — Test**

Point `logline scan` at a real project that uses this domain and verify the coverage report looks correct.

---

## Contribution Area 2: The Synthesis Prompt

The synthesis step (`src/lib/pipeline/05-synthesize-events.ts`) converts raw code interactions into named analytics events. Improving it makes event names better for every user.

### How It Works

`buildSynthesisPrompt` constructs the LLM prompt from detected interactions and a `ProductProfile`. The LLM returns events with `name`, `description`, `priority`, and `sourceInteractions`.

### Extension Points

- **Improve the prompt** — modify `buildSynthesisPrompt` to include more product context (actors, objects, expected sequences from `ProductProfile`). More context yields better names.
- **Improve `guessEventName`** — the regex-based fast-mode fallback. Better heuristics here improve `--fast` mode with no API cost.
- **Extend `extractPropertiesFromInteraction`** — add extraction passes for GraphQL variables, React Hook Form, Zod schemas, or other common patterns.
- **Extend verb mappings** — the `toPastTense` map and the VerbObject/ObjectVerb regex patterns control how handler names become event names.

### Testing Synthesis Changes

```bash
npm run build && npm test
```

For manual testing, run `logline scan --verbose` on any project with `OPENAI_API_KEY` set to see LLM input/output.

---

## Adding a New Interaction Detector

Interaction detectors live in `src/lib/pipeline/04-detect-interactions.ts`. The file has five detectors (`detectUITriggers`, `detectHandlerDeclarations`, `detectRouteHandlers`, `detectGenericCRUD`, `detectMutationHooks`).

To add a new detector:

1. Write a function `detectMyPattern(file, content, lines): RawInteraction[]`
2. Call it inside `detectInteractions` and spread the result into `interactions`
3. Set `type` to an existing `RawInteraction['type']`, or add a new type to `src/lib/pipeline/types.ts` and handle it in `inferSignalType` in step 05

---

## PR Guidelines

- **One thing per PR.** A new convention domain, a prompt improvement, or a bug fix — not all three.
- **Tests required.** Run `npm test` before submitting. PRs that break existing tests won't be merged.
- **Convention PRs** should include a link to a real-world project that demonstrates the domain being detected.
- **Synthesis PRs** should show before/after examples of event names generated from the same interaction.
- Keep commit messages in the imperative: `add marketplace convention domain`, `fix: avoid generic names for api_call interactions`.
