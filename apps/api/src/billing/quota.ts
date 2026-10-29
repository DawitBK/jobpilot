import { ProblemException } from '@jobpilot/kit';
import { and, count, eq, gte, ne, sql } from 'drizzle-orm';
import type { Tx } from '../db/db.module.js';
import {
  applicationDocuments,
  applications,
  jobSources,
  organizationMembers,
  organizations,
} from '../db/schema.js';
import { fits, PLANS, RESOURCE_LABEL, type PlanName, type QuotaResource } from './plans.js';

export type Usage = Record<QuotaResource, number>;

const monthStart = sql`(date_trunc('month', now() at time zone 'utc') at time zone 'utc')`;

export async function planOf(tx: Tx, organizationId: string): Promise<PlanName> {
  const [org] = await tx
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, organizationId));
  return (org?.plan ?? 'FREE') as PlanName;
}

/** What the organization is using now. Counted from the records themselves, so it can never drift from them. */
export async function usageOf(tx: Tx, organizationId: string): Promise<Usage> {
  const [members, sources, apps, docs] = await Promise.all([
    tx
      .select({ n: count() })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, 'ACTIVE'),
        ),
      ),
    tx.select({ n: count() }).from(jobSources).where(eq(jobSources.organizationId, organizationId)),
    tx
      .select({ n: count() })
      .from(applications)
      .where(
        and(
          eq(applications.organizationId, organizationId),
          gte(applications.createdAt, monthStart),
        ),
      ),
    tx
      .select({ n: count() })
      .from(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.organizationId, organizationId),
          // Documents a person wrote themselves cost nothing; only the AI's count against the plan.
          ne(applicationDocuments.provider, 'manual'),
          gte(applicationDocuments.createdAt, monthStart),
        ),
      ),
  ]);
  return {
    members: members[0]?.n ?? 0,
    sources: sources[0]?.n ?? 0,
    applications: apps[0]?.n ?? 0,
    aiGenerations: docs[0]?.n ?? 0,
  };
}

/**
 * Refuses (402, with the numbers) when adding would pass the plan's limit. Call it inside the same
 * transaction that adds the thing, so two requests cannot both squeeze under the limit unseen:
 * the organization row is locked while the count is taken.
 */
export async function assertWithinQuota(
  tx: Tx,
  organizationId: string,
  resource: QuotaResource,
  /** True when the new thing is already inserted in this transaction (so it is in the count): it is then taken out of "used". */
  inserted = false,
): Promise<void> {
  await tx.execute(sql`select 1 from organizations where id = ${organizationId} for update`);
  const plan = await planOf(tx, organizationId);
  const usage = await usageOf(tx, organizationId);
  const used = inserted ? Math.max(usage[resource] - 1, 0) : usage[resource];
  if (fits(plan, resource, used, 1)) return;
  const limit = PLANS[plan].limits[resource];
  throw new ProblemException(
    402,
    'quota-exceeded',
    'Your plan does not include more of this',
    `The ${PLANS[plan].label} plan allows ${limit} ${RESOURCE_LABEL[resource]}; you are already using ${used}. Change the plan to add more.`,
    { resource, limit, used, plan },
  );
}

/** How many more of this the organization may add right now; `null` when the plan has no limit. */
export async function roomFor(
  tx: Tx,
  organizationId: string,
  resource: QuotaResource,
): Promise<number | null> {
  const plan = await planOf(tx, organizationId);
  const limit = PLANS[plan].limits[resource];
  if (limit === null) return null;
  const usage = await usageOf(tx, organizationId);
  return Math.max(limit - usage[resource], 0);
}
