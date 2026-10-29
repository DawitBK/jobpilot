import { describe, expect, it } from 'vitest';
import {
  AnthropicProvider,
  OpenAiCompatibleProvider,
  buildProvider,
  serverConnection,
} from './provider.js';

/** A fetch that answers with what a vendor would, and remembers what it was asked. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const ask = { system: 'sys', user: 'hello', maxTokens: 100 };

describe('one door, any vendor', () => {
  it('speaks the chat-completions protocol to Groq, OpenAI or any compatible address', async () => {
    const { impl, calls } = fakeFetch(200, {
      model: 'm-1',
      choices: [{ message: { content: '{"content":"hi"}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 5 },
    });
    const p = new OpenAiCompatibleProvider(
      'groq',
      'https://api.groq.com/openai/v1/',
      'key-1',
      'openai/gpt-oss-120b',
      impl,
    );
    const answer = await p.complete(ask);
    expect(answer).toEqual({
      text: '{"content":"hi"}',
      model: 'm-1',
      inputTokens: 12,
      outputTokens: 5,
    });
    expect(calls[0]!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const sent = JSON.parse(calls[0]!.init.body as string);
    expect(sent).toMatchObject({ model: 'openai/gpt-oss-120b', max_tokens: 100 });
    expect(sent.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
    ]);
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer key-1',
    );
  });

  it('speaks the native Messages protocol to Anthropic', async () => {
    const { impl, calls } = fakeFetch(200, {
      model: 'c-1',
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 3, output_tokens: 1 },
    });
    const answer = await new AnthropicProvider('key-2', 'claude-sonnet-5-5', impl).complete(ask);
    expect(answer.text).toBe('hello');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect((calls[0]!.init.headers as Record<string, string>)['x-api-key']).toBe('key-2');
    expect(JSON.parse(calls[0]!.init.body as string).system).toBe('sys');
  });

  it('gives the same plain answers whichever vendor failed', async () => {
    for (const make of [
      (f: typeof fetch) => new OpenAiCompatibleProvider('openai', 'https://x.test/v1', 'k', 'm', f),
      (f: typeof fetch) => new AnthropicProvider('k', 'm', f),
    ]) {
      await expect(make(fakeFetch(401, {}).impl).complete(ask)).rejects.toMatchObject({
        status: 502,
      });
      await expect(make(fakeFetch(429, {}).impl).complete(ask)).rejects.toMatchObject({
        status: 503,
      });
      await expect(make(fakeFetch(500, {}).impl).complete(ask)).rejects.toMatchObject({
        status: 502,
      });
      await expect(
        make(
          fakeFetch(200, { choices: [{ message: { content: '  ' } }], content: [] }).impl,
        ).complete(ask),
      ).rejects.toMatchObject({ status: 502 });
      const offline = (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch;
      await expect(make(offline).complete(ask)).rejects.toMatchObject({ status: 502 });
    }
  });

  it('builds the right provider from a connection, with the vendor default address', () => {
    expect(buildProvider({ vendor: 'groq', apiKey: 'k', model: 'm' }).name).toBe('groq');
    expect(buildProvider({ vendor: 'anthropic', apiKey: 'k', model: 'm' }).name).toBe('anthropic');
    expect(
      buildProvider({ vendor: 'custom', apiKey: 'k', model: 'm', baseUrl: 'https://x.test/v1' })
        .name,
    ).toBe('custom');
    expect(() => buildProvider({ vendor: 'custom', apiKey: 'k', model: 'm' })).toThrow(
      /base address/,
    );
  });
});

describe("the server's own connection, from the same names DMS uses", () => {
  it('finds nothing without a key', () => {
    expect(serverConnection({})).toBeNull();
  });

  it('prefers Groq, then OpenAI, then a custom address, then Anthropic', () => {
    expect(
      serverConnection({ GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' }),
    ).toMatchObject({
      vendor: 'groq',
      model: 'openai/gpt-oss-120b',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
    expect(serverConnection({ OPENAI_API_KEY: 'o', ANTHROPIC_API_KEY: 'a' })).toMatchObject({
      vendor: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    });
    expect(
      serverConnection({ AI_BASE_URL: 'https://router.test/v1', AI_API_KEY: 'c', AI_MODEL: 'x/y' }),
    ).toMatchObject({ vendor: 'custom', model: 'x/y', baseUrl: 'https://router.test/v1' });
    expect(serverConnection({ ANTHROPIC_API_KEY: 'a' })).toMatchObject({
      vendor: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
    // A bare AI_API_KEY means Anthropic (as in DMS), unless an address says it is something else.
    expect(serverConnection({ AI_API_KEY: 'a' })).toMatchObject({ vendor: 'anthropic' });
  });

  it('lets AI_PROVIDER force a vendor, and refuses a name it does not know', () => {
    const env = { GROQ_API_KEY: 'g', OPENAI_API_KEY: 'o', OPENAI_MODEL: 'gpt-x' };
    expect(serverConnection({ ...env, AI_PROVIDER: 'openai' })).toMatchObject({
      vendor: 'openai',
      model: 'gpt-x',
    });
    expect(serverConnection({ ...env, AI_PROVIDER: 'anthropic' })).toBeNull();
    expect(() => serverConnection({ ...env, AI_PROVIDER: 'skynet' })).toThrow(/not one of/);
  });
});
