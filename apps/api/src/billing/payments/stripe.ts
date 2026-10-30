import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadWebhookError,
  type CheckoutRequest,
  type CheckoutResult,
  type HttpFetch,
  type PaymentProvider,
  type PaymentVerification,
} from './provider.js';

const API = 'https://api.stripe.com/v1';
/** Stripe's own rule: a signature older than this is a replay. */
const TOLERANCE_SECONDS = 300;

/** Stripe Checkout (one-off payment for one month of a plan, in US dollars). */
export class StripeProvider implements PaymentProvider {
  readonly id = 'stripe' as const;
  readonly label = 'Card (Stripe)';
  readonly currency = 'USD' as const;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
    private readonly http: HttpFetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: request.returnUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.reference,
      customer_email: request.customer.email,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': request.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(request.amountMinor),
      'line_items[0][price_data][product_data][name]': request.description,
      'metadata[order]': request.reference,
    });
    const res = await this.http(`${API}/checkout/sessions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };
    if (!res.ok || !body.url) {
      throw new Error(`Stripe refused the checkout: ${body.error?.message ?? res.status}`);
    }
    return { checkoutUrl: body.url, providerReference: body.id ?? null };
  }

  readWebhook(rawBody: string, headers: Record<string, string | undefined>) {
    const header = headers['stripe-signature'] ?? '';
    const parts = Object.fromEntries(
      header.split(',').map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
      }),
    );
    const timestamp = Number(parts['t']);
    if (!timestamp || !parts['v1']) throw new BadWebhookError('missing signature');
    if (Math.abs(this.now() / 1000 - timestamp) > TOLERANCE_SECONDS)
      throw new BadWebhookError('stale signature');
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    const given = Buffer.from(parts['v1'], 'hex');
    const wanted = Buffer.from(expected, 'hex');
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new BadWebhookError('wrong signature');
    }
    const event = JSON.parse(rawBody) as {
      type?: string;
      data?: { object?: { client_reference_id?: string | null } };
    };
    if (
      event.type !== 'checkout.session.completed' &&
      event.type !== 'checkout.session.async_payment_succeeded'
    ) {
      return null;
    }
    const reference = event.data?.object?.client_reference_id;
    return reference ? { reference } : null;
  }

  async verify(_reference: string, providerReference: string | null): Promise<PaymentVerification> {
    if (!providerReference) return { paid: false, amountMinor: null, currency: null };
    const res = await this.http(
      `${API}/checkout/sessions/${encodeURIComponent(providerReference)}`,
      {
        headers: { authorization: `Bearer ${this.secretKey}` },
      },
    );
    if (!res.ok) return { paid: false, amountMinor: null, currency: null };
    const session = (await res.json()) as {
      payment_status?: string;
      amount_total?: number;
      currency?: string;
    };
    return {
      paid: session.payment_status === 'paid',
      amountMinor: session.amount_total ?? null,
      currency: session.currency?.toUpperCase() ?? null,
    };
  }
}
