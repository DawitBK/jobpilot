import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProblemException, unprocessable } from '@jobpilot/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { enqueue, recordAudit } from '../../common/audit.js';
import type { Principal } from '../../common/auth.js';
import { conflict } from '../../common/errors.js';
import { organizations, paymentOrders, users, type PaymentOrderRow } from '../../db/schema.js';
import { TenantDb } from '../../db/tenant.js';
import { PLANS, PLAN_NAMES, type PlanName } from '../plans.js';
import { planOf } from '../quota.js';
import { PaymentProviders } from './registry.js';
import { BadWebhookError, type ProviderInfo } from './provider.js';

export const PAYMENT_PROVIDERS = 'JOBPILOT_PAYMENT_PROVIDERS';
export const PAYMENT_OPTIONS = 'JOBPILOT_PAYMENT_OPTIONS';
export interface PaymentOptions {
  /** The public address of the web app: where the provider sends the buyer back. */
  appUrl: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A plan is bought, never bought down: moving to a smaller plan is free and goes through the plan switch. */
const RANK: Record<PlanName, number> = { FREE: 0, PRO: 1, TEAM: 2, ENTERPRISE: 3 };

export interface OrderDto {
  id: string;
  plan: PlanName;
  provider: string;
  amountMinor: number;
  currency: string;
  status: PaymentOrderRow['status'];
  failure: string | null;
  createdAt: string;
  paidAt: string | null;
}

const toDto = (o: PaymentOrderRow): OrderDto => ({
  id: o.id,
  plan: o.plan as PlanName,
  provider: o.provider,
  amountMinor: o.amountMinor,
  currency: o.currency,
  status: o.status,
  failure: o.failure,
  createdAt: o.createdAt.toISOString(),
  paidAt: o.paidAt ? o.paidAt.toISOString() : null,
});

@Injectable()
export class PaymentsService {
  private readonly log = new Logger('payments');

  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(PAYMENT_PROVIDERS) readonly providers: PaymentProviders,
    @Inject(PAYMENT_OPTIONS) private readonly options: PaymentOptions,
  ) {}

  list(): { connected: boolean; providers: ProviderInfo[] } {
    return { connected: this.providers.connected, providers: this.providers.list() };
  }

  /** Does moving to `target` have to be paid for? Only when a provider is connected, and only going up to a priced plan. */
  mustPayFor(current: PlanName, target: PlanName): boolean {
    return this.providers.connected && RANK[target] > RANK[current] && target !== 'FREE';
  }

  /** Starts a purchase: a pending order, and the address of the provider's page where the buyer pays. */
  async checkout(p: Principal, input: { plan: PlanName; provider: string }) {
    const provider = this.providers.get(input.provider);
    if (!provider) {
      throw unprocessable(
        'provider-unavailable',
        'That way of paying is not available on this server',
      );
    }
    const spec = PLANS[input.plan];
    const price = provider.currency === 'USD' ? spec.priceUsdPerMonth : spec.priceEtbPerMonth;
    if (!price) {
      throw unprocessable('plan-not-for-sale', `${spec.label} cannot be bought here`, input.plan);
    }

    const { order, customer } = await this.tenant.inTenant(p, async (tx) => {
      const current = await planOf(tx, p.organizationId);
      if (RANK[input.plan] <= RANK[current]) {
        throw conflict('already-on-plan', `This workspace is already on ${PLANS[current].label}`);
      }
      const [row] = await tx
        .insert(paymentOrders)
        .values({
          organizationId: p.organizationId,
          requestedBy: p.userId,
          plan: input.plan,
          provider: provider.id,
          amountMinor: Math.round(price * 100),
          currency: provider.currency,
        })
        .returning();
      const [person] = await tx.select().from(users).where(eq(users.id, p.userId));
      return {
        order: row!,
        customer: { email: person?.email ?? '', name: person?.fullName ?? '' },
      };
    });

    const back = this.options.appUrl.replace(/\/+$/, '');
    try {
      const result = await provider.createCheckout({
        reference: order.id,
        plan: input.plan,
        description: `JobPilot ${spec.label}, one month`,
        amountMinor: order.amountMinor,
        currency: order.currency,
        customer,
        returnUrl: `${back}/billing?payment=return`,
        cancelUrl: `${back}/billing?payment=cancelled`,
      });
      await this.tenant.inTenant(p, (tx) =>
        tx
          .update(paymentOrders)
          .set({ checkoutUrl: result.checkoutUrl, providerReference: result.providerReference })
          .where(eq(paymentOrders.id, order.id)),
      );
      return { orderId: order.id, checkoutUrl: result.checkoutUrl };
    } catch (e) {
      const failure = (e as Error).message.slice(0, 300);
      await this.tenant.inTenant(p, (tx) =>
        tx
          .update(paymentOrders)
          .set({ status: 'FAILED', failure })
          .where(eq(paymentOrders.id, order.id)),
      );
      this.log.warn(`checkout ${order.id} failed: ${failure}`);
      throw new ProblemException(
        502,
        'provider-failed',
        'The payment provider did not answer',
        failure,
      );
    }
  }

  async orders(p: Principal): Promise<OrderDto[]> {
    return this.tenant.inTenant(p, async (tx) => {
      const rows = await tx
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.organizationId, p.organizationId))
        .orderBy(desc(paymentOrders.createdAt))
        .limit(20);
      return rows.map(toDto);
    });
  }

  /**
   * A provider tells us (by webhook) that an order was paid. The webhook is never believed on its own: its signature is
   * checked, it only NAMES an order, and the provider is then asked directly whether that order was paid, for how much.
   * Safe to receive any number of times: only a PENDING order is ever completed.
   */
  async handleWebhook(
    providerId: string,
    rawBody: string,
    headers: Record<string, string | undefined>,
  ): Promise<'ignored' | 'bad-signature' | 'paid' | 'pending' | 'refused'> {
    const provider = this.providers.get(providerId);
    if (!provider) return 'ignored';
    let named: { reference: string } | null;
    try {
      named = provider.readWebhook(rawBody, headers);
    } catch (e) {
      if (e instanceof BadWebhookError) return 'bad-signature';
      return 'ignored'; // a body that is not even JSON
    }
    if (!named || !UUID.test(named.reference)) return 'ignored';

    // Which workspace is this order for? Read through the one narrow lookup the database allows without a tenant.
    const order = await this.tenant.global(async (tx) => {
      await tx.execute(sql`select set_config('app.payment_lookup', ${named.reference}, true)`);
      const [row] = await tx
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.id, named.reference));
      return row;
    });
    if (!order || order.provider !== provider.id || order.status !== 'PENDING') return 'ignored';

    const verification = await provider.verify(order.id, order.providerReference);
    if (!verification.paid) return 'pending';

    return this.tenant.inTenant(
      { organizationId: order.organizationId, userId: order.requestedBy },
      async (tx) => {
        // Locked, and looked at again: two webhooks for the same order must not both complete it.
        const [fresh] = await tx
          .select()
          .from(paymentOrders)
          .where(and(eq(paymentOrders.id, order.id), eq(paymentOrders.status, 'PENDING')))
          .for('update');
        if (!fresh) return 'ignored';
        const wrongAmount =
          verification.amountMinor !== fresh.amountMinor ||
          verification.currency?.toUpperCase() !== fresh.currency.toUpperCase();
        if (wrongAmount) {
          await tx
            .update(paymentOrders)
            .set({
              status: 'FAILED',
              failure: `The provider reports ${verification.amountMinor} ${verification.currency}, the order was ${fresh.amountMinor} ${fresh.currency}`,
            })
            .where(eq(paymentOrders.id, fresh.id));
          await recordAudit(tx, {
            organizationId: fresh.organizationId,
            actorUserId: null,
            actorType: 'SYSTEM',
            action: 'billing.payment_refused',
            resourceType: 'payment_order',
            resourceId: fresh.id,
            before: null,
            after: { reason: 'amount or currency does not match the order' },
          });
          return 'refused' as const;
        }
        const before = await planOf(tx, fresh.organizationId);
        const plan = PLAN_NAMES.find((n) => n === fresh.plan)!;
        await tx
          .update(paymentOrders)
          .set({ status: 'PAID', paidAt: sql`now()` })
          .where(eq(paymentOrders.id, fresh.id));
        if (RANK[plan] > RANK[before]) {
          await tx
            .update(organizations)
            .set({ plan })
            .where(eq(organizations.id, fresh.organizationId));
          await enqueue(tx, fresh.organizationId, 'plan.changed', { from: before, to: plan });
        }
        await recordAudit(tx, {
          organizationId: fresh.organizationId,
          actorUserId: null,
          actorType: 'SYSTEM',
          action: 'billing.plan_paid',
          resourceType: 'payment_order',
          resourceId: fresh.id,
          before: { plan: before },
          after: {
            plan,
            provider: fresh.provider,
            amountMinor: fresh.amountMinor,
            currency: fresh.currency,
          },
        });
        return 'paid' as const;
      },
    );
  }
}
