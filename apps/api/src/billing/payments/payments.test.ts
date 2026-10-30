import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ChapaProvider } from './chapa.js';
import { BadWebhookError, toMajor, toMinor, type CheckoutRequest } from './provider.js';
import { PaymentProviders } from './registry.js';
import { StripeProvider } from './stripe.js';

const ORDER = '0194c1e0-0000-7000-8000-000000000001';
const request: CheckoutRequest = {
  reference: ORDER,
  plan: 'PRO',
  description: 'JobPilot Pro, one month',
  amountMinor: 1900,
  currency: 'USD',
  customer: { email: 'buyer@example.test', name: 'Bea Buyer' },
  returnUrl: 'https://app.example.test/billing?payment=return',
  cancelUrl: 'https://app.example.test/billing?payment=cancelled',
};

interface Call {
  url: string;
  init: RequestInit;
}
/** A stand-in for fetch that records what was sent and answers with canned JSON. */
function fakeHttp(answer: unknown, status = 200) {
  const calls: Call[] = [];
  const http = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  return { http, calls };
}

describe('amounts', () => {
  it('converts between the smallest unit and the decimal some providers want', () => {
    expect(toMajor(1900)).toBe('19.00');
    expect(toMajor(250000)).toBe('2500.00');
    expect(toMinor('19.00')).toBe(1900);
    expect(toMinor(2500.5)).toBe(250050);
  });
});

describe('Stripe', () => {
  const secret = 'whsec_test_secret';
  const now = 1_800_000_000_000;
  const stripe = (http?: typeof fetch) => new StripeProvider('sk_test_x', secret, http, () => now);
  const signed = (body: string, t = now / 1000) =>
    `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
  const event = (type: string, ref: string | null = ORDER) =>
    JSON.stringify({ type, data: { object: { client_reference_id: ref } } });

  it('creates a one-off checkout in dollars and reads the page address back', async () => {
    const { http, calls } = fakeHttp({ id: 'cs_1', url: 'https://checkout.stripe.test/cs_1' });
    const result = await stripe(http).createCheckout(request);
    expect(result).toEqual({
      checkoutUrl: 'https://checkout.stripe.test/cs_1',
      providerReference: 'cs_1',
    });
    const sent = new URLSearchParams(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(sent.get('client_reference_id')).toBe(ORDER);
    expect(sent.get('line_items[0][price_data][unit_amount]')).toBe('1900');
    expect(sent.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(sent.get('mode')).toBe('payment');
    expect((calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      'Bearer sk_test_x',
    );
  });

  it('says so when Stripe refuses', async () => {
    const { http } = fakeHttp({ error: { message: 'Invalid API Key' } }, 401);
    await expect(stripe(http).createCheckout(request)).rejects.toThrow(/Invalid API Key/);
  });

  it('accepts a webhook signed over the exact bytes and names the order', () => {
    const body = event('checkout.session.completed');
    expect(stripe().readWebhook(body, { 'stripe-signature': signed(body) })).toEqual({
      reference: ORDER,
    });
  });

  it('refuses a changed body, a wrong secret, a missing header and a replayed signature', () => {
    const body = event('checkout.session.completed');
    const good = signed(body);
    const tampered = body.replace(ORDER, '0194c1e0-0000-7000-8000-0000000000ff');
    expect(() => stripe().readWebhook(tampered, { 'stripe-signature': good })).toThrow(
      BadWebhookError,
    );
    expect(() => stripe().readWebhook(body, { 'stripe-signature': 't=1,v1=abcd' })).toThrow(
      BadWebhookError,
    );
    expect(() => stripe().readWebhook(body, {})).toThrow(BadWebhookError);
    const old = signed(body, now / 1000 - 3600);
    expect(() => stripe().readWebhook(body, { 'stripe-signature': old })).toThrow(/stale/);
  });

  it('ignores events that are not about a finished payment', () => {
    const body = event('customer.created');
    expect(stripe().readWebhook(body, { 'stripe-signature': signed(body) })).toBeNull();
    const none = event('checkout.session.completed', null);
    expect(stripe().readWebhook(none, { 'stripe-signature': signed(none) })).toBeNull();
  });

  it('asks Stripe whether the session was paid, and for how much', async () => {
    const paid = fakeHttp({ payment_status: 'paid', amount_total: 1900, currency: 'usd' });
    expect(await stripe(paid.http).verify(ORDER, 'cs_1')).toEqual({
      paid: true,
      amountMinor: 1900,
      currency: 'USD',
    });
    expect(paid.calls[0]!.url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1');
    const unpaid = fakeHttp({ payment_status: 'unpaid', amount_total: 1900, currency: 'usd' });
    expect((await stripe(unpaid.http).verify(ORDER, 'cs_1')).paid).toBe(false);
    expect((await stripe().verify(ORDER, null)).paid).toBe(false); // no session was ever created
  });
});

describe('Chapa', () => {
  const birr = { ...request, amountMinor: 250000, currency: 'ETB' };
  const chapa = (http?: typeof fetch, webhookSecret?: string) =>
    new ChapaProvider('CHASECK_x', webhookSecret, http);

  it('creates a checkout in birr with our order as the reference', async () => {
    const { http, calls } = fakeHttp({
      status: 'success',
      data: { checkout_url: 'https://checkout.chapa.test/abc' },
    });
    const result = await chapa(http).createCheckout(birr);
    expect(result).toEqual({
      checkoutUrl: 'https://checkout.chapa.test/abc',
      providerReference: ORDER,
    });
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({
      amount: '2500.00',
      currency: 'ETB',
      tx_ref: ORDER,
      first_name: 'Bea',
      last_name: 'Buyer',
    });
    expect(calls[0]!.url).toBe('https://api.chapa.co/v1/transaction/initialize');
  });

  it('says so when Chapa refuses', async () => {
    const { http } = fakeHttp({ status: 'failed', message: 'Invalid key' }, 400);
    await expect(chapa(http).createCheckout(birr)).rejects.toThrow(/Invalid key/);
  });

  it('names the order from a webhook, and checks the signature when a secret is set', () => {
    const body = JSON.stringify({ tx_ref: ORDER, status: 'success' });
    expect(chapa().readWebhook(body, {})).toEqual({ reference: ORDER });
    const secret = 'webhook-secret';
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    expect(chapa(undefined, secret).readWebhook(body, { 'x-chapa-signature': sig })).toEqual({
      reference: ORDER,
    });
    expect(chapa(undefined, secret).readWebhook(body, { 'chapa-signature': sig })).toEqual({
      reference: ORDER,
    });
    expect(() =>
      chapa(undefined, secret).readWebhook(body, { 'x-chapa-signature': 'wrong' }),
    ).toThrow(BadWebhookError);
    expect(() => chapa(undefined, secret).readWebhook(body, {})).toThrow(BadWebhookError);
  });

  it('confirms a payment with Chapa itself, in santim', async () => {
    const paid = fakeHttp({
      status: 'success',
      data: { status: 'success', amount: '2500.00', currency: 'ETB' },
    });
    expect(await chapa(paid.http).verify(ORDER)).toEqual({
      paid: true,
      amountMinor: 250000,
      currency: 'ETB',
    });
    expect(paid.calls[0]!.url).toBe(`https://api.chapa.co/v1/transaction/verify/${ORDER}`);
    const pending = fakeHttp({
      status: 'success',
      data: { status: 'pending', amount: 2500, currency: 'ETB' },
    });
    expect((await chapa(pending.http).verify(ORDER)).paid).toBe(false);
    const missing = fakeHttp({ message: 'not found' }, 404);
    expect((await chapa(missing.http).verify(ORDER)).paid).toBe(false);
  });
});

describe('the providers a server has', () => {
  it('has none without keys, and says what is missing for each', () => {
    const none = PaymentProviders.fromSettings({});
    expect(none.connected).toBe(false);
    const listed = none.list();
    expect(listed.map((p) => p.id)).toEqual(['stripe', 'chapa', 'telebirr']);
    expect(listed.every((p) => !p.available && p.reason)).toBe(true);
  });

  it('needs both Stripe keys, but only the one Chapa key', () => {
    expect(PaymentProviders.fromSettings({ STRIPE_SECRET_KEY: 'sk_test_x' }).connected).toBe(false);
    const both = PaymentProviders.fromSettings({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
    });
    expect(both.get('stripe')?.currency).toBe('USD');
    const chapa = PaymentProviders.fromSettings({ CHAPA_SECRET_KEY: 'CHASECK_x' });
    expect(chapa.get('chapa')?.currency).toBe('ETB');
    expect(chapa.list().find((p) => p.id === 'chapa')?.available).toBe(true);
  });

  it('never offers direct Telebirr: it needs a merchant agreement this server does not have', () => {
    const all = PaymentProviders.fromSettings({
      STRIPE_SECRET_KEY: 'sk_test_x',
      STRIPE_WEBHOOK_SECRET: 'whsec_x',
      CHAPA_SECRET_KEY: 'CHASECK_x',
    });
    const telebirr = all.list().find((p) => p.id === 'telebirr')!;
    expect(telebirr.available).toBe(false);
    expect(all.get('telebirr')).toBeUndefined();
  });
});
