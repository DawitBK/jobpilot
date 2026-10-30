import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BadWebhookError,
  type CheckoutRequest,
  type CheckoutResult,
  type PaymentProvider,
  type PaymentVerification,
} from '../src/billing/payments/provider.js';
import { PaymentProviders } from '../src/billing/payments/registry.js';
import {
  closeContext,
  joinAs,
  signUp,
  startContext,
  type Session,
  type TestContext,
} from './helpers.js';

/**
 * A provider that behaves like a real one: it signs the exact bytes of its webhook (so the test proves the application reads the raw
 * body), it only calls an order paid when the test says the buyer paid, and it can be told to fail.
 */
class FakeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly label = 'Fake card';
  readonly currency = 'USD' as const;
  readonly checkouts: CheckoutRequest[] = [];
  readonly paid = new Map<string, { amountMinor: number; currency: string }>();
  failCheckout = false;

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    if (this.failCheckout) throw new Error('the provider is down');
    this.checkouts.push(request);
    return {
      checkoutUrl: `https://pay.example.test/${request.reference}`,
      providerReference: `ps_${request.reference}`,
    };
  }
  readWebhook(rawBody: string, headers: Record<string, string | undefined>) {
    if (headers['x-fake-signature'] !== sign(rawBody)) throw new BadWebhookError('bad');
    const body = JSON.parse(rawBody) as { reference?: string };
    return body.reference ? { reference: body.reference } : null;
  }
  async verify(reference: string): Promise<PaymentVerification> {
    const p = this.paid.get(reference);
    return p ? { paid: true, ...p } : { paid: false, amountMinor: null, currency: null };
  }
}
const sign = (raw: string) => createHash('sha256').update(`fake-secret:${raw}`).digest('hex');

let ctx: TestContext;
let fake: FakeProvider;
beforeAll(async () => {
  fake = new FakeProvider();
  ctx = await startContext({ paymentProviders: new PaymentProviders([fake]) });
});
afterAll(async () => {
  await closeContext(ctx);
});

const checkout = (s: Session, body: Record<string, unknown>) =>
  ctx.http().post('/api/v1/billing/checkout').set(s.auth).send(body);
const plan = async (s: Session) =>
  (await ctx.http().get('/api/v1/billing').set(s.auth)).body.plan as string;
/** The provider calls our webhook with a signed body naming the order. */
const webhook = (reference: string, signature?: string) => {
  const raw = JSON.stringify({ reference, event: 'paid' });
  return ctx
    .http()
    .post('/api/v1/billing/webhooks/stripe')
    .set('content-type', 'application/json')
    .set('x-fake-signature', signature ?? sign(raw))
    .send(raw);
};
const orderRows = (organizationId: string) =>
  ctx.owner.query('select * from payment_orders where organization_id = $1 order by created_at', [
    organizationId,
  ]);

describe('paying for a plan', () => {
  it('lists the providers, and says which one cannot be used here and why', async () => {
    const s = await signUp(ctx, 'Lister');
    const res = await ctx.http().get('/api/v1/billing/providers').set(s.auth);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    const byId = Object.fromEntries(res.body.providers.map((p: { id: string }) => [p.id, p]));
    expect(byId['stripe']).toMatchObject({ available: true, currency: 'USD' });
    expect(byId['chapa'].available).toBe(false);
    expect(byId['chapa'].reason).toMatch(/CHAPA_SECRET_KEY/);
    expect(byId['telebirr'].available).toBe(false);
    expect(byId['telebirr'].reason).toMatch(/merchant/i);
  });

  it('refuses a free upgrade once a provider is connected', async () => {
    const s = await signUp(ctx, 'Upgrader');
    const up = await ctx.http().put('/api/v1/billing/plan').set(s.auth).send({ plan: 'PRO' });
    expect(up.status).toBe(402);
    expect(up.body.code).toBe('payment-required');
    expect(await plan(s)).toBe('FREE');
    expect((await ctx.http().get('/api/v1/billing').set(s.auth)).body.payment.connected).toBe(true);
  });

  it('starts a purchase: a pending order at the list price, and the provider page to go to', async () => {
    const s = await signUp(ctx, 'Buyer');
    const res = await checkout(s, { plan: 'PRO', provider: 'stripe' });
    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toBe(`https://pay.example.test/${res.body.orderId}`);
    const [order] = (await orderRows(s.organizationId)).rows;
    expect(order).toMatchObject({
      plan: 'PRO',
      provider: 'stripe',
      status: 'PENDING',
      currency: 'USD',
    });
    expect(Number(order.amount_minor)).toBe(1900);
    expect(fake.checkouts.at(-1)).toMatchObject({
      reference: order.id,
      amountMinor: 1900,
      currency: 'USD',
    });
    expect(await plan(s)).toBe('FREE'); // nothing changes until the provider confirms
  });

  it('refuses what cannot be bought: a free or unpriced plan, an unknown provider', async () => {
    const s = await signUp(ctx, 'Refused');
    expect((await checkout(s, { plan: 'FREE', provider: 'stripe' })).status).toBe(422);
    expect((await checkout(s, { plan: 'ENTERPRISE', provider: 'stripe' })).status).toBe(422);
    expect((await checkout(s, { plan: 'PRO', provider: 'chapa' })).status).toBe(422);
    expect((await checkout(s, { plan: 'PRO', provider: 'nonsense' })).status).toBe(422);
    expect((await orderRows(s.organizationId)).rows).toHaveLength(0);
  });

  it('is for people who manage billing only', async () => {
    const owner = await signUp(ctx, 'Owner');
    const member = await joinAs(ctx, owner, await signUp(ctx, 'Hiring Manager'), 'HIRING_MANAGER');
    expect((await checkout(member, { plan: 'PRO', provider: 'stripe' })).status).toBe(403);
    expect((await ctx.http().get('/api/v1/billing/orders').set(member.auth)).status).toBe(403);
  });

  it('upgrades only when the provider confirms, once, with a record of who and how', async () => {
    const s = await signUp(ctx, 'Paying');
    const { orderId } = (await checkout(s, { plan: 'PRO', provider: 'stripe' })).body;

    // A webhook before the buyer has paid changes nothing: the provider is asked, and says no.
    expect((await webhook(orderId)).status).toBe(200);
    expect(await plan(s)).toBe('FREE');

    fake.paid.set(orderId, { amountMinor: 1900, currency: 'USD' });
    expect((await webhook(orderId)).status).toBe(200);
    expect(await plan(s)).toBe('PRO');
    const [order] = (await orderRows(s.organizationId)).rows;
    expect(order.status).toBe('PAID');
    expect(order.paid_at).not.toBeNull();

    // The same webhook again (providers repeat themselves) does nothing more.
    await webhook(orderId);
    const audit = await ctx.owner.query(
      `select actor_type, action from audit_logs where organization_id = $1 and action = 'billing.plan_paid'`,
      [s.organizationId],
    );
    expect(audit.rows).toEqual([{ actor_type: 'SYSTEM', action: 'billing.plan_paid' }]);
    const events = await ctx.owner.query(
      `select count(*)::int as n from outbox_events where organization_id = $1 and event_type = 'plan.changed'`,
      [s.organizationId],
    );
    expect(events.rows[0].n).toBe(1);
    // Buying the plan you already have is refused.
    expect((await checkout(s, { plan: 'PRO', provider: 'stripe' })).status).toBe(409);
    const listed = await ctx.http().get('/api/v1/billing/orders').set(s.auth);
    expect(listed.body[0]).toMatchObject({ id: orderId, status: 'PAID', plan: 'PRO' });
  });

  it('refuses a webhook with a wrong signature, and ignores one for an order that does not exist', async () => {
    const s = await signUp(ctx, 'Forged');
    const { orderId } = (await checkout(s, { plan: 'PRO', provider: 'stripe' })).body;
    fake.paid.set(orderId, { amountMinor: 1900, currency: 'USD' });
    expect((await webhook(orderId, 'not-the-signature')).status).toBe(400);
    expect(await plan(s)).toBe('FREE');
    expect((await webhook(randomUUID())).status).toBe(200); // acknowledged, ignored
    expect((await webhook('not-an-order-id')).status).toBe(200);
  });

  it('does not upgrade when the provider says a different amount was paid', async () => {
    const s = await signUp(ctx, 'Underpaid');
    const { orderId } = (await checkout(s, { plan: 'TEAM', provider: 'stripe' })).body;
    fake.paid.set(orderId, { amountMinor: 100, currency: 'USD' });
    await webhook(orderId);
    expect(await plan(s)).toBe('FREE');
    const [order] = (await orderRows(s.organizationId)).rows;
    expect(order.status).toBe('FAILED');
    expect(order.failure).toMatch(/order was 9900/);
  });

  it('keeps each workspace to its own orders, and the runtime role sees none without one', async () => {
    const a = await signUp(ctx, 'Workspace A');
    const b = await signUp(ctx, 'Workspace B');
    await checkout(a, { plan: 'PRO', provider: 'stripe' });
    expect((await ctx.http().get('/api/v1/billing/orders').set(b.auth)).body).toEqual([]);
    expect(
      (await ctx.runtime.query('select count(*)::int as n from payment_orders')).rows[0].n,
    ).toBe(0);
  });

  it('records a provider that is down as a failed order and says so, changing nothing', async () => {
    const s = await signUp(ctx, 'Unlucky');
    fake.failCheckout = true;
    try {
      const res = await checkout(s, { plan: 'PRO', provider: 'stripe' });
      expect(res.status).toBe(502);
      expect(res.body.detail).toMatch(/provider is down/);
    } finally {
      fake.failCheckout = false;
    }
    expect((await orderRows(s.organizationId)).rows[0].status).toBe('FAILED');
    expect(await plan(s)).toBe('FREE');
  });
});
