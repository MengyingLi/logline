import OpenAI from 'openai';

let clientInstance: OpenAI | null = null;
let clientApiKey: string | null = null;

export function getLLMClient(apiKey: string): OpenAI {
  if (!clientInstance || clientApiKey !== apiKey) {
    clientInstance = new OpenAI({ apiKey });
    clientApiKey = apiKey;
  }
  return clientInstance;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function llmCall<T>(opts: {
  apiKey: string;
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  verbose?: boolean;
  fallback: T;
}): Promise<T> {
  const maxAttempts = 2;
  const model = opts.model ?? 'gpt-4o-mini';
  const temperature = opts.temperature ?? 0.2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const client = getLLMClient(opts.apiKey);
      if (opts.verbose) {
        const promptPreview = opts.prompt.length > 2500 ? opts.prompt.slice(0, 2500) + '…(truncated)' : opts.prompt;
        console.log('\n[LLM prompt preview]\n' + promptPreview + '\n');
      }
      const response = await client.chat.completions.create({
        model,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user', content: opts.prompt },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return opts.fallback;
      if (opts.verbose) {
        const respPreview = content.length > 2000 ? content.slice(0, 2000) + '…(truncated)' : content;
        console.log('[LLM response preview]\n' + respPreview + '\n');
      }
      return JSON.parse(content) as T;
    } catch (error: any) {
      const message = String(error?.message ?? '').toLowerCase();
      const status = Number(error?.status ?? 0);
      const shouldRetry =
        attempt < maxAttempts &&
        (status === 429 ||
          message.includes('rate limit') ||
          message.includes('timeout') ||
          message.includes('timed out'));

      if (shouldRetry) {
        await sleep(5000);
        continue;
      }

      return opts.fallback;
    }
  }

  return opts.fallback;
}
