# Logline

Auto-instrument product analytics from your codebase. Logline scans your code, understands your product, and generates tracking events with a single command.

## What it does

```
Your Code → Logline → Analytics Events PR
```

1. **Scans** your codebase to understand your product's domain
2. **Detects** meaningful business events (not just CRUD operations)
3. **Generates** a PR with tracking code in the right places

## Quick Start

```bash
# Install
npm install -g logline

# Set your OpenAI API key (for smart event detection)
export OPENAI_API_KEY=sk-...

# Scan your project
cd your-project
logline scan

# Preview changes
logline pr --dry-run

# Create the PR
logline pr
```

## Example Output

```
🔍 Analyzing codebase for missing analytics...

Found 5 events to add:

  • workflow_edited → src/components/workflow/StepConfigPanel.tsx
  • template_selected → src/pages/Index.tsx
  • workflow_tested → src/pages/Index.tsx
  • step_tested → src/pages/Index.tsx
  • trigger_selected → src/pages/Index.tsx

📝 Preview of changes:

────────────────────────────────────────────────────────────
📄 src/pages/Index.tsx:160
────────────────────────────────────────────────────────────
  160 │   const handleTemplateSelect = (template: WorkflowTemplate) => {
+     │   // Logline: template_selected
+     │   track('template_selected', {
+     │     template_id: template?.id,
+     │     user_id: user?.id,
+     │   });
  161 │     setWorkflow((prev) => ({
```

## Commands

| Command | Description |
|---------|-------------|
| `logline scan` | Analyze your codebase and detect missing events |
| `logline scan --fast` | Quick scan without LLM analysis |
| `logline scan --granular` | Show all interactions (no grouping) |
| `logline spec` | Generate event specifications |
| `logline pr --dry-run` | Preview the tracking code changes |
| `logline pr` | Create a PR with analytics instrumentation |

## How It Works

### 1. Product Understanding

Logline uses LLM to understand your product:

```
📊 Product Profile
   Mission: Workflow automation for teams
   Key Metrics: workflows_created, workflow_executions
   Confidence: 87%
```

### 2. Smart Event Detection

Instead of generic CRUD events, Logline detects meaningful business events:

| ❌ Generic | ✅ Logline |
|-----------|-----------|
| `mapping_created` | `workflow_edited` |
| `mapping_deleted` | (grouped into workflow_edited) |
| `button_clicked` | `workflow_tested` |
| `form_submitted` | `template_selected` |

### 3. Intelligent Code Insertion

Logline finds the right place to add tracking:

- ✅ Inside handler functions (not JSX)
- ✅ Infers properties from code context
- ✅ Uses function parameters correctly
- ✅ Adds imports automatically

## Supported Stacks

**Frameworks:**
- React / Next.js
- Vue (coming soon)
- Express / Fastify

**Databases (for schema detection):**
- Supabase / PostgreSQL
- Prisma
- Drizzle

**Analytics destinations:**
- Segment
- PostHog
- Mixpanel
- Custom

## Configuration

Create `.logline/config.json` to customize:

```json
{
  "eventGranularity": "business",
  "tracking": {
    "destination": "segment",
    "debug": true
  }
}
```

## Generated Analytics Module

Logline creates `src/lib/analytics.ts` if it doesn't exist:

```typescript
export function track(eventName: string, properties: Record<string, unknown>): void {
  // TODO: Replace with your analytics provider
  // - Segment: analytics.track(eventName, properties)
  // - PostHog: posthog.capture(eventName, properties)

  if (process.env.NODE_ENV === 'development') {
    console.log('[Analytics]', eventName, properties);
  }
}
```

## Event Spec Format

Generated specs in `.logline/specs/`:

```json
{
  "eventName": "workflow_edited",
  "description": "User modified their workflow",
  "actor": "User",
  "object": "Workflow",
  "properties": [
    { "name": "workflow_id", "type": "string", "required": true },
    { "name": "user_id", "type": "string", "required": true },
    { "name": "changes", "type": "array", "required": false }
  ],
  "suggestedLocations": [
    { "file": "src/components/StepConfigPanel.tsx", "line": 25 }
  ],
  "priority": "high"
}
```

## Development

```bash
# Clone
git clone https://github.com/MengyingLi/logline
cd logline

# Install dependencies
npm install

# Build
npm run build

# Link for local testing
npm link

# Test on a project
cd /path/to/test-project
logline scan
```

## Requirements

- Node.js 18+
- OpenAI API key (for smart detection)
- Git (for PR creation)
- GitHub CLI `gh` (optional, for auto PR creation)

## FAQ

**Q: Does it work without OpenAI?**

Yes, use `logline scan --fast` for regex-only detection. Results won't be as smart but it's free and instant.

**Q: Will it break my code?**

Always use `logline pr --dry-run` first to preview changes. The PR workflow means you can review before merging.

**Q: What events should I track?**

Logline prioritizes:
1. **Activation** - first value moments
2. **Engagement** - core product usage
3. **Retention** - actions that predict stickiness

## License

MIT

---

Built by [Mengying Li](https://github.com/MengyingLi)
