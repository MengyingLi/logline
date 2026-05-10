import OpenAI from 'openai';

// ─── Provider detection ───────────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'gemini';

export interface LLMKey {
  key: string;
  provider: LLMProvider;
}

/**
 * Return the first available LLM API key from the environment.
 * Priority: OpenAI → Anthropic → Gemini
 */
export function getLLMApiKey(): LLMKey | null {
  const openai = process.env.OPENAI_API_KEY;
  if (openai) return { key: openai, provider: 'openai' };

  const anthropic = process.env.ANTHROPIC_API_KEY;
  if (anthropic) return { key: anthropic, provider: 'anthropic' };

  const gemini = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_KEY;
  if (gemini) return { key: gemini, provider: 'gemini' };

  return null;
}

/** Human-readable list of supported env var names, for error messages. */
export const LLM_KEY_ENV_VARS = 'OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY';

// ─── OpenAI ──────────────────────────────────────────────────────────────────

let openaiClient: OpenAI | null = null;
let openaiClientKey: string | null = null;

function getOpenAIClient(apiKey: string): OpenAI {
  if (!openaiClient || openaiClientKey !== apiKey) {
    openaiClient = new OpenAI({ apiKey });
    openaiClientKey = apiKey;
  }
  return openaiClient;
}

async function callOpenAI<T>(opts: CallOpts<T>): Promise<T> {
  const client = getOpenAIClient(opts.apiKey);
  const response = await client.chat.completions.create({
    model: opts.model ?? 'gpt-4o-mini',
    temperature: opts.temperature ?? 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.prompt },
    ],
  });
  const content = response.choices[0]?.message?.content;
  if (!content) return opts.fallback;
  return JSON.parse(content) as T;
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

async function callAnthropic<T>(opts: CallOpts<T>): Promise<T> {
  const model = opts.model?.startsWith('claude') ? opts.model : 'claude-haiku-4-5-20251001';
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: opts.system + '\n\nReturn only valid JSON. No markdown, no explanation.',
      messages: [{ role: 'user', content: opts.prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
  const data = await res.json() as { content: Array<{ type: string; text: string }> };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '';
  // Strip any markdown code fences the model might add
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned) as T;
}

// ─── Gemini ───────────────────────────────────────────────────────────────────

async function callGemini<T>(opts: CallOpts<T>): Promise<T> {
  const model = opts.model?.startsWith('gemini') ? opts.model : 'gemini-1.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: {
        temperature: opts.temperature ?? 0.2,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`);
  const data = await res.json() as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> };
  const text = data.candidates[0]?.content?.parts[0]?.text ?? '';
  return JSON.parse(text) as T;
}

// ─── Unified llmCall ──────────────────────────────────────────────────────────

interface CallOpts<T> {
  apiKey: string;
  provider?: LLMProvider;
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  verbose?: boolean;
  fallback: T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function detectProvider(apiKey: string): LLMProvider {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('AIza')) return 'gemini';
  return 'openai';
}

export async function llmCall<T>(opts: {
  apiKey: string;
  provider?: LLMProvider;
  system: string;
  prompt: string;
  model?: string;
  temperature?: number;
  verbose?: boolean;
  fallback: T;
}): Promise<T> {
  const provider = opts.provider ?? detectProvider(opts.apiKey);
  const maxAttempts = 2;

  if (opts.verbose) {
    const preview = opts.prompt.length > 2500 ? opts.prompt.slice(0, 2500) + '…(truncated)' : opts.prompt;
    console.log(`\n[LLM prompt — ${provider}]\n${preview}\n`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const callOpts: CallOpts<T> = { ...opts, provider };

      let result: T;
      if (provider === 'anthropic') result = await callAnthropic(callOpts);
      else if (provider === 'gemini') result = await callGemini(callOpts);
      else result = await callOpenAI(callOpts);

      if (opts.verbose) {
        const resp = JSON.stringify(result);
        const preview = resp.length > 2000 ? resp.slice(0, 2000) + '…(truncated)' : resp;
        console.log(`[LLM response]\n${preview}\n`);
      }

      return result;
    } catch (error: any) {
      const message = String(error?.message ?? '').toLowerCase();
      const status = Number(error?.status ?? 0);
      const shouldRetry =
        attempt < maxAttempts &&
        (status === 429 ||
          message.includes('rate limit') ||
          message.includes('timeout') ||
          message.includes('timed out') ||
          message.includes('overloaded'));

      if (shouldRetry) {
        await sleep(5000);
        continue;
      }

      return opts.fallback;
    }
  }

  return opts.fallback;
}

// Keep for backwards compatibility — used by BusinessReasoner directly
export function getLLMClient(apiKey: string): OpenAI {
  return getOpenAIClient(apiKey);
}
