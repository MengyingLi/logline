import type { SynthesizedEvent } from '@logline/cli';

export function buildSuggestionComment(event: SynthesizedEvent, trackingCode: string): string {
  return `### 📊 Logline: Track \`${event.name}\`

${event.description}

**Priority:** ${event.priority}
${event.includes?.length ? `**Groups:** ${event.includes.join(', ')}` : ''}

\`\`\`suggestion
${trackingCode}
\`\`\`

<details>
<summary>Why track this?</summary>

This ${event.priority}-priority event helps measure ${event.name.replace(/_/g, ' ')}.

</details>

---
*🤖 [Logline](https://github.com/MengyingLi/logline) — auto-instrument product analytics*`;
}

