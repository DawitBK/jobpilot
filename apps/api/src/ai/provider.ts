import { ProblemException } from '@jobpilot/kit';

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** A language model behind one small door. The gateway never gives it tools, files or the database. */
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

/**
 * Which vendor, and how to reach it. `openai-compatible` covers Groq, OpenAI, OpenRouter, Together, Fireworks,
 * Mistral, a local Ollama or vLLM, and anything else that speaks the chat-completions protocol; `anthropic`
 * is the native Messages API. Nothing else in the application knows which vendor is behind the door.
 */
export const AI_VENDORS = ['groq', 'openai', 'anthropic', 'custom'] as const;
export type AiVendor = (typeof AI_VENDORS)[number];

export interface AiConnection {
  vendor: AiVendor;
  apiKey: string;
  model: string;
  /** Base address of an OpenAI-compatible API (not used by `anthropic`). */
  baseUrl?: string;
}

/** Builds a provider from a connection; replaced in tests so no suite ever calls out. */
export type AiProviderFactory = (connection: AiConnection) => AiProvider;
export const AI_PROVIDER_FACTORY = 'JOBPILOT_AI_PROVIDER_FACTORY';
export const AI_SETTINGS = 'JOBPILOT_AI_SETTINGS';

/** What the server itself offers when an organization has stored no connection of its own. */
export interface AiSettings {
  /** The vendors the server has keys for, in the order they are tried (see `serverConnection`). */
  server: AiConnection | null;
  /** Allow `custom` base addresses that are private (a local Ollama): only for a self-hosted server. */
  allowPrivateBaseUrls: boolean;
}

export const DEFAULT_MODELS: Record<AiVendor, string> = {
  groq: 'openai/gpt-oss-120b',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-5-5',
  custom: 'gpt-4o-mini',
};
export const DEFAULT_BASE_URLS: Partial<Record<AiVendor, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  openai: 'https://api.openai.com/v1',
};

export interface AiEnv {
  AI_PROVIDER?: string | undefined;
  GROQ_API_KEY?: string | undefined;
  GROQ_MODEL?: string | undefined;
  OPENAI_API_KEY?: string | undefined;
  OPENAI_MODEL?: string | undefined;
  OPENAI_BASE_URL?: string | undefined;
  AI_BASE_URL?: string | undefined;
  AI_API_KEY?: string | undefined;
  AI_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  ANTHROPIC_MODEL?: string | undefined;
}

/**
 * The server's own connection, from the same environment names DMS uses so one operator vocabulary covers both:
 * `AI_PROVIDER` forces a vendor, otherwise the first of Groq, OpenAI, custom (AI_BASE_URL + AI_API_KEY) and
 * Anthropic that has a key is used.
 */
export function serverConnection(env: AiEnv): AiConnection | null {
  const make: Record<AiVendor, () => AiConnection | null> = {
    groq: () =>
      env.GROQ_API_KEY
        ? {
            vendor: 'groq',
            apiKey: env.GROQ_API_KEY,
            model: env.GROQ_MODEL ?? DEFAULT_MODELS.groq,
            baseUrl: DEFAULT_BASE_URLS.groq,
          }
        : null,
    openai: () =>
      env.OPENAI_API_KEY
        ? {
            vendor: 'openai',
            apiKey: env.OPENAI_API_KEY,
            model: env.OPENAI_MODEL ?? DEFAULT_MODELS.openai,
            baseUrl: env.OPENAI_BASE_URL ?? DEFAULT_BASE_URLS.openai,
          }
        : null,
    custom: () =>
      env.AI_BASE_URL && env.AI_API_KEY
        ? {
            vendor: 'custom',
            apiKey: env.AI_API_KEY,
            model: env.AI_MODEL ?? DEFAULT_MODELS.custom,
            baseUrl: env.AI_BASE_URL,
          }
        : null,
    anthropic: () => {
      const apiKey = env.ANTHROPIC_API_KEY ?? (env.AI_BASE_URL ? undefined : env.AI_API_KEY);
      return apiKey
        ? { vendor: 'anthropic', apiKey, model: env.ANTHROPIC_MODEL ?? DEFAULT_MODELS.anthropic }
        : null;
    },
  };
  const forced = env.AI_PROVIDER?.toLowerCase();
  if (forced) {
    if (!(AI_VENDORS as readonly string[]).includes(forced)) {
      throw new Error(`AI_PROVIDER="${forced}" is not one of: ${AI_VENDORS.join(', ')}`);
    }
    return make[forced as AiVendor]();
  }
  return make.groq() ?? make.openai() ?? make.custom() ?? make.anthropic();
}

/** Turns an error from any vendor into the same plain answers, so callers and screens never depend on the vendor. */
function failure(status: number | 'network' | 'timeout', vendor: string): ProblemException {
  if (status === 'network' || status === 'timeout') {
    return new ProblemException(
      502,
      'ai-unreachable',
      'The AI service could not be reached',
      `${status === 'timeout' ? 'It took too long to answer' : 'The request failed'}. Try again in a moment.`,
    );
  }
  if (status === 401 || status === 403) {
    return new ProblemException(
      502,
      'ai-key-rejected',
      'The AI provider rejected the API key',
      `Check the ${vendor} key stored for this organization (or the server default).`,
    );
  }
  if (status === 429) {
    return new ProblemException(
      503,
      'ai-busy',
      'The AI service is busy',
      'It asked us to slow down. Try again shortly.',
    );
  }
  return new ProblemException(
    502,
    'ai-provider-error',
    'The AI provider returned an error',
    `It answered with status ${status}.`,
  );
}

const badAnswer = () =>
  new ProblemException(
    502,
    'ai-bad-response',
    'The AI provider sent nothing usable',
    'The answer had no text.',
  );

/** The native Anthropic Messages API. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          system: request.system,
          messages: [{ role: 'user', content: request.user }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw failure((error as Error).name === 'TimeoutError' ? 'timeout' : 'network', 'Anthropic');
    }
    if (!res.ok) throw failure(res.status, 'Anthropic');
    const body = (await res.json().catch(() => null)) as {
      content?: { type: string; text?: string }[];
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    } | null;
    const text =
      body?.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('') ?? '';
    if (!text) throw badAnswer();
    return {
      text,
      model: body?.model ?? this.model,
      inputTokens: body?.usage?.input_tokens,
      outputTokens: body?.usage?.output_tokens,
    };
  }
}

/** Any chat-completions API: Groq, OpenAI, OpenRouter, Together, Fireworks, Mistral, a local Ollama or vLLM. */
export class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly name: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxTokens,
          temperature: 0.2,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (error) {
      throw failure((error as Error).name === 'TimeoutError' ? 'timeout' : 'network', this.name);
    }
    if (!res.ok) throw failure(res.status, this.name);
    const body = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null } }[];
      model?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    } | null;
    const text = body?.choices?.[0]?.message?.content ?? '';
    if (!text.trim()) throw badAnswer();
    return {
      text,
      model: body?.model ?? this.model,
      inputTokens: body?.usage?.prompt_tokens,
      outputTokens: body?.usage?.completion_tokens,
    };
  }
}

export const buildProvider: AiProviderFactory = (c) => {
  if (c.vendor === 'anthropic') return new AnthropicProvider(c.apiKey, c.model);
  const base = c.baseUrl ?? DEFAULT_BASE_URLS[c.vendor];
  if (!base) throw new Error(`A base address is required for the ${c.vendor} vendor`);
  return new OpenAiCompatibleProvider(c.vendor, base, c.apiKey, c.model);
};
