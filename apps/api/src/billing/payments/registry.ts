import { ChapaProvider } from './chapa.js';
import {
  PROVIDER_IDS,
  type HttpFetch,
  type PaymentProvider,
  type ProviderId,
  type ProviderInfo,
} from './provider.js';
import { StripeProvider } from './stripe.js';

export interface PaymentSettings {
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_WEBHOOK_SECRET?: string | undefined;
  CHAPA_SECRET_KEY?: string | undefined;
  CHAPA_WEBHOOK_SECRET?: string | undefined;
}

/** The providers this server can use. Nothing is guessed: a provider without its keys is simply not available. */
export class PaymentProviders {
  private readonly byId = new Map<ProviderId, PaymentProvider>();

  constructor(providers: PaymentProvider[] = []) {
    for (const p of providers) this.byId.set(p.id, p);
  }

  static fromSettings(settings: PaymentSettings, http?: HttpFetch): PaymentProviders {
    const found: PaymentProvider[] = [];
    if (settings.STRIPE_SECRET_KEY && settings.STRIPE_WEBHOOK_SECRET) {
      found.push(
        new StripeProvider(settings.STRIPE_SECRET_KEY, settings.STRIPE_WEBHOOK_SECRET, http),
      );
    }
    if (settings.CHAPA_SECRET_KEY) {
      found.push(new ChapaProvider(settings.CHAPA_SECRET_KEY, settings.CHAPA_WEBHOOK_SECRET, http));
    }
    return new PaymentProviders(found);
  }

  /** True when at least one provider can take a payment: plans then have to be paid for. */
  get connected(): boolean {
    return this.byId.size > 0;
  }

  get(id: string): PaymentProvider | undefined {
    return this.byId.get(id as ProviderId);
  }

  /** Every known provider and whether it works here. */
  list(): ProviderInfo[] {
    return PROVIDER_IDS.map((id) => {
      const p = this.byId.get(id);
      if (p) return { id, label: p.label, currency: p.currency, available: true };
      return UNAVAILABLE[id];
    });
  }
}

const UNAVAILABLE: Record<ProviderId, ProviderInfo> = {
  stripe: {
    id: 'stripe',
    label: 'Card (Stripe)',
    currency: 'USD',
    available: false,
    reason: 'Not set up on this server: STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are missing.',
  },
  chapa: {
    id: 'chapa',
    label: 'Birr (Chapa: Telebirr, bank, card)',
    currency: 'ETB',
    available: false,
    reason: 'Not set up on this server: CHAPA_SECRET_KEY is missing.',
  },
  telebirr: {
    id: 'telebirr',
    label: 'Telebirr (direct)',
    currency: 'ETB',
    available: false,
    reason:
      'Direct Telebirr needs a merchant agreement with Ethio telecom and its integration credentials, which this server does not have. Telebirr wallets can already be used through Chapa.',
  },
};
