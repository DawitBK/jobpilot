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

/** Builds a provider from an API key; replaced in tests so no suite ever calls out. */
export type AiProviderFactory = (apiKey: string) => AiProvider;
export const AI_PROVIDER_FACTORY = 'JOBPILOT_AI_PROVIDER_FACTORY';
export const AI_SETTINGS = 'JOBPILOT_AI_SETTINGS';

export interface AiSettings {
  /** A platform-wide key, used when an organization has stored none of its own. */
  defaultApiKey?: string;
  model: string;
}

const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

/** The Anthropic Messages API, called with plain fetch: no SDK, one request, one response, a timeout. */
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
      res = await this.fetchImpl(MESSAGES_URL, {
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
      throw new ProblemException(
        502,
        'ai-unreachable',
        'The AI service could not be reached',
        `${(error as Error).name === 'TimeoutError' ? 'It took too long to answer' : 'The request failed'}. Try again in a moment.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProblemException(
        502,
        'ai-key-rejected',
        'The AI provider rejected the API key',
        'Check the key stored for this organization (or the server default).',
      );
    }
    if (res.status === 429) {
      throw new ProblemException(
        503,
        'ai-busy',
        'The AI service is busy',
        'It asked us to slow down. Try again shortly.',
      );
    }
    if (!res.ok) {
      throw new ProblemException(
        502,
        'ai-provider-error',
        'The AI provider returned an error',
        `It answered with status ${res.status}.`,
      );
    }
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
    if (!text) {
      throw new ProblemException(
        502,
        'ai-bad-response',
        'The AI provider sent nothing usable',
        'The answer had no text.',
      );
    }
    return {
      text,
      model: body?.model ?? this.model,
      inputTokens: body?.usage?.input_tokens,
      outputTokens: body?.usage?.output_tokens,
    };
  }
}
