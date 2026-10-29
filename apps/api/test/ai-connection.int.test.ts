import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProblemException } from '@jobpilot/kit';
import {
  closeContext,
  joinAs,
  signUp,
  startContext,
  type Session,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await startContext();
});
afterAll(async () => {
  await closeContext(ctx);
});

const put = (s: Session, body: Record<string, unknown>) =>
  ctx.http().put('/api/v1/ai/connection').set(s.auth).send(body);
const get = (s: Session) => ctx.http().get('/api/v1/ai/connection').set(s.auth);

describe("an organization's AI connection, whichever vendor it is", () => {
  it('starts with nothing, then keeps the vendor, model and the last four characters of the key, and never the key', async () => {
    const owner = await signUp(ctx, 'Connector');
    expect((await get(owner)).body).toEqual({
      configured: false,
      source: null,
      vendor: null,
      model: null,
      baseUrl: null,
      hint: null,
    });
    const saved = await put(owner, { vendor: 'groq', apiKey: 'gsk_test_key_abcd1234' });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({
      configured: true,
      source: 'organization',
      vendor: 'groq',
      model: 'openai/gpt-oss-120b',
      hint: '1234',
    });
    expect(JSON.stringify(saved.body)).not.toContain('gsk_test_key');
    const stored = (
      await ctx.owner.query(
        'select ciphertext, hint from organization_secrets where organization_id = $1',
        [owner.organizationId],
      )
    ).rows[0];
    expect(stored.ciphertext).not.toContain('gsk_test_key');
    expect(stored.ciphertext).not.toContain('groq');
    // Replacing it with another vendor is the same call.
    const other = await put(owner, {
      vendor: 'anthropic',
      apiKey: 'sk-ant-test-key-9999',
      model: 'claude-haiku-5-5',
    });
    expect(other.body).toMatchObject({
      vendor: 'anthropic',
      model: 'claude-haiku-5-5',
      baseUrl: null,
      hint: '9999',
    });
    expect((await ctx.http().delete('/api/v1/ai/connection').set(owner.auth)).status).toBe(204);
    expect((await ctx.http().delete('/api/v1/ai/connection').set(owner.auth)).status).toBe(404);
    expect((await get(owner)).body.configured).toBe(false);
  });

  it('accepts any OpenAI-compatible service by its address, and only public https addresses on a shared server', async () => {
    const owner = await signUp(ctx, 'Custom Vendor');
    expect((await put(owner, { vendor: 'custom', apiKey: 'tok_custom_000001' })).status).toBe(422);
    const refused = [
      'http://127.0.0.1:11434/v1',
      'https://localhost/v1',
      'https://10.0.0.5/v1',
      'http://api.example.com/v1',
    ];
    for (const baseUrl of refused) {
      const r = await put(owner, { vendor: 'custom', apiKey: 'tok_custom_000001', baseUrl });
      expect(r.status, baseUrl).toBe(422);
      expect(r.body.code).toBe('base-url-refused');
    }
    expect((await get(owner)).body.configured).toBe(false);
  });

  it('is for people who manage AI settings, and private to the organization', async () => {
    const owner = await signUp(ctx, 'Vault Owner');
    const recruiter = await joinAs(ctx, owner, await signUp(ctx, 'Vault Recruiter'), 'RECRUITER');
    expect((await put(recruiter, { vendor: 'groq', apiKey: 'gsk_test_key_abcd1234' })).status).toBe(
      403,
    );
    expect((await get(recruiter)).status).toBe(403);
    await put(owner, { vendor: 'openai', apiKey: 'sk-openai-test-abcd1234' });
    const stranger = await signUp(ctx, 'Vault Stranger');
    expect((await get(stranger)).body.configured).toBe(false);
    expect((await put(owner, { vendor: 'groq', apiKey: 'short' })).status).toBe(400);
    expect((await put(owner, { vendor: 'madeup', apiKey: 'gsk_test_key_abcd1234' })).status).toBe(
      400,
    );
    expect(
      (await put(owner, { vendor: 'groq', apiKey: 'gsk_test_key_abcd1234', extra: 1 })).status,
    ).toBe(400);
  });

  it('proves a connection with a real request through whichever vendor is saved, and says why when it fails', async () => {
    const owner = await signUp(ctx, 'Tester');
    expect((await ctx.http().post('/api/v1/ai/connection/test').set(owner.auth)).status).toBe(503);
    await put(owner, { vendor: 'openai', apiKey: 'sk-openai-test-abcd1234' });
    ctx.ai.reply = () => 'OK';
    const ok = await ctx.http().post('/api/v1/ai/connection/test').set(owner.auth);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ ok: true, vendor: 'fake', model: 'fake-model-1' });
    expect(ctx.ai.connections.at(-1)).toMatchObject({
      vendor: 'openai',
      model: 'gpt-4o-mini',
      baseUrl: 'https://api.openai.com/v1',
    });
    ctx.ai.fail = new ProblemException(
      502,
      'ai-key-rejected',
      'The AI provider rejected the API key',
      'Check the key.',
    );
    try {
      const bad = await ctx.http().post('/api/v1/ai/connection/test').set(owner.auth);
      expect(bad.status).toBe(502);
      expect(bad.body.code).toBe('ai-key-rejected');
    } finally {
      ctx.ai.fail = null;
    }
  });
});
