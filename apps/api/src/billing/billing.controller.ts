import { Body, Controller, Get, Inject, Put } from '@nestjs/common';
import { conflict, ProblemException, ZodValidationPipe } from '@jobpilot/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { enqueue, recordAudit } from '../common/audit.js';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import { organizations } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { PaymentsService } from './payments/payments.service.js';
import { PLAN_NAMES, PLANS, RESOURCE_LABEL, type PlanName } from './plans.js';
import { planOf, usageOf } from './quota.js';

export const changePlanSchema = z.object({ plan: z.enum(PLAN_NAMES) }).strict();
type ChangePlan = z.output<typeof changePlanSchema>;

export const quotaLineSchema = z.object({
  resource: z.enum(['members', 'sources', 'applications', 'aiGenerations']),
  label: z.string(),
  used: z.number().int(),
  limit: z.number().int().nullable(),
});
export const planSpecSchema = z.object({
  name: z.enum(PLAN_NAMES),
  label: z.string(),
  priceUsdPerMonth: z.number().nullable(),
  limits: z.object({
    members: z.number().int().nullable(),
    sources: z.number().int().nullable(),
    applications: z.number().int().nullable(),
    aiGenerations: z.number().int().nullable(),
  }),
});
export const billingSchema = z.object({
  plan: z.enum(PLAN_NAMES),
  quotas: z.array(quotaLineSchema),
  plans: z.array(planSpecSchema),
  /** No payment provider is connected: a plan change takes effect at once and nothing is charged. */
  payment: z.object({ connected: z.boolean(), note: z.string() }),
});

const NOT_CONNECTED =
  'No payment provider is connected, so plans switch immediately and nothing is charged.';
const CONNECTED =
  'Moving to a bigger plan is paid for through a payment provider; moving down is free.';

@Controller('api/v1/billing')
export class BillingController {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  /** The plan, what it allows, and how much of it the organization is using. */
  @RequirePermission('analytics:read')
  @Get()
  get(@CurrentUser() p: Principal) {
    return this.tenant.inTenant(p, async (tx) => this.view(await tx, p.organizationId));
  }

  /** Change the plan. Moving down is refused while the organization uses more than the smaller plan allows. */
  @RequirePermission('billing:manage')
  @Put('plan')
  change(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(changePlanSchema)) body: ChangePlan,
  ) {
    return this.tenant.inTenant(p, async (tx) => {
      const before = await planOf(tx, p.organizationId);
      if (this.payments.mustPayFor(before, body.plan)) {
        throw new ProblemException(
          402,
          'payment-required',
          'Payment required',
          `${PLANS[body.plan].label} has to be paid for: start a checkout (POST /billing/checkout).`,
        );
      }
      if (before !== body.plan) {
        const usage = await usageOf(tx, p.organizationId);
        const target = PLANS[body.plan].limits;
        const over = (['members', 'sources'] as const).filter(
          (r) => target[r] !== null && usage[r] > target[r],
        );
        if (over.length > 0) {
          throw conflict(
            'plan-too-small',
            `The ${PLANS[body.plan].label} plan is too small for what you use now`,
            `You use ${over.map((r) => `${usage[r]} ${RESOURCE_LABEL[r]}`).join(' and ')}; ${PLANS[body.plan].label} allows ${over.map((r) => target[r]).join(' and ')}. Remove some first.`,
          );
        }
        await tx
          .update(organizations)
          .set({ plan: body.plan })
          .where(eq(organizations.id, p.organizationId));
        await recordAudit(tx, {
          organizationId: p.organizationId,
          actorUserId: p.userId,
          actorType: 'USER',
          action: 'billing.plan_changed',
          resourceType: 'organization',
          resourceId: p.organizationId,
          before: { plan: before },
          after: { plan: body.plan },
        });
        await enqueue(tx, p.organizationId, 'plan.changed', { from: before, to: body.plan });
      }
      return this.view(tx, p.organizationId);
    });
  }

  private async view(tx: Parameters<typeof planOf>[0], organizationId: string) {
    const plan: PlanName = await planOf(tx, organizationId);
    const usage = await usageOf(tx, organizationId);
    return {
      plan,
      quotas: (Object.keys(usage) as (keyof typeof usage)[]).map((resource) => ({
        resource,
        label: RESOURCE_LABEL[resource],
        used: usage[resource],
        limit: PLANS[plan].limits[resource],
      })),
      plans: PLAN_NAMES.map((n) => PLANS[n]),
      payment: {
        connected: this.payments.providers.connected,
        note: this.payments.providers.connected ? CONNECTED : NOT_CONNECTED,
      },
    };
  }
}
