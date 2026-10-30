import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadWebhookError,
  toMajor,
  toMinor,
  type CheckoutRequest,
  type CheckoutResult,
  type HttpFetch,
  type PaymentProvider,
  type PaymentVerification,
} from './provider.js';

const API = 'https://api.chapa.co/v1';

/** Chapa (cards, Telebirr wallet, CBE Birr and bank transfer through one checkout page), in Ethiopian birr. */
export class ChapaProvider implements PaymentProvider {
  readonly id = 'chapa' as const;
  readonly label = 'Birr (Chapa: Telebirr, bank, card)';
  readonly currency = 'ETB' as const;

  constructor(
    private readonly secretKey: string,
    /** Optional: when set, a webhook without a matching signature is refused. Payment is confirmed with Chapa either way. */
    private readonly webhookSecret: string | undefined,
    private readonly http: HttpFetch = fetch,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const [first, ...rest] = request.customer.name.trim().split(/\s+/);
    const res = await this.http(`${API}/transaction/initialize`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.secretKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        amount: toMajor(request.amountMinor),
        currency: request.currency,
        email: request.customer.email,
        first_name: first || 'JobPilot',
        last_name: rest.join(' ') || 'Customer',
        tx_ref: request.reference,
        return_url: request.returnUrl,
        customization: { title: 'JobPilot', description: request.description.slice(0, 50) },
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
      data?: { checkout_url?: string };
    };
    const url = body.data?.checkout_url;
    if (!res.ok || body.status !== 'success' || !url) {
      throw new Error(
        `Chapa refused the checkout: ${typeof body.message === 'string' ? body.message : res.status}`,
      );
    }
    return { checkoutUrl: url, providerReference: request.reference };
  }

  readWebhook(rawBody: string, headers: Record<string, string | undefined>) {
    if (this.webhookSecret) {
      const given = headers['x-chapa-signature'] ?? headers['chapa-signature'] ?? '';
      const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(given.toLowerCase(), 'utf8');
      const b = Buffer.from(expected, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b))
        throw new BadWebhookError('wrong signature');
    }
    const event = JSON.parse(rawBody) as { tx_ref?: string; status?: string };
    return event.tx_ref ? { reference: event.tx_ref } : null;
  }

  async verify(reference: string): Promise<PaymentVerification> {
    const res = await this.http(`${API}/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) return { paid: false, amountMinor: null, currency: null };
    const body = (await res.json()) as {
      status?: string;
      data?: { status?: string; amount?: number | string; currency?: string };
    };
    const data = body.data;
    return {
      paid: body.status === 'success' && data?.status === 'success',
      amountMinor: data?.amount === undefined ? null : toMinor(data.amount),
      currency: data?.currency?.toUpperCase() ?? null,
    };
  }
}
