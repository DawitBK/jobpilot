import type { PlanName } from '../plans.js';

export const PROVIDER_IDS = ['stripe', 'chapa', 'telebirr'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface CheckoutRequest {
  /** Our order id: sent to the provider as its reference, and read back from its webhook. */
  reference: string;
  plan: PlanName;
  /** What the buyer sees on the provider's page. */
  description: string;
  amountMinor: number;
  currency: string;
  customer: { email: string; name: string };
  returnUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  /** The provider's own id for the payment, when it has one. */
  providerReference: string | null;
}

export interface PaymentVerification {
  paid: boolean;
  amountMinor: number | null;
  currency: string | null;
}

/**
 * One way to take a payment. Every provider answers the same four questions, so the rest of the application does not know
 * which one it is talking to (the same idea as the AI providers). A provider is never trusted for what its webhook says:
 * the webhook only names an order, and `verify` asks the provider itself, server to server, whether that order was paid.
 */
export interface PaymentProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** What this provider charges in. */
  readonly currency: 'USD' | 'ETB';
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
  /**
   * Checks that a webhook really came from the provider (its signature) and returns the order it is about, or null when it is
   * a notice about something else. Throws `BadWebhookError` when the signature is wrong.
   */
  readWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): { reference: string } | null;
  verify(reference: string, providerReference: string | null): Promise<PaymentVerification>;
}

export class BadWebhookError extends Error {}

/** What the billing screen lists: every provider the application knows, and whether it can be used on this server. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  currency: 'USD' | 'ETB';
  available: boolean;
  /** Why it cannot be used, in plain words. */
  reason?: string;
}

export type HttpFetch = typeof fetch;

/** Amounts are kept in the smallest unit (cents, santim); providers that take a decimal amount get it from here. */
export const toMajor = (minor: number): string => (minor / 100).toFixed(2);
export const toMinor = (major: string | number): number => Math.round(Number(major) * 100);
