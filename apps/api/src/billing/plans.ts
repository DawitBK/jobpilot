export const PLAN_NAMES = ['FREE', 'PRO', 'TEAM', 'ENTERPRISE'] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export type QuotaResource = 'members' | 'sources' | 'applications' | 'aiGenerations';

/** `null` means no limit. Members and sources are totals; applications and AI generations are per calendar month (UTC). */
export type PlanLimits = Record<QuotaResource, number | null>;

export interface PlanSpec {
  name: PlanName;
  label: string;
  /** Shown to people; charged only when a payment provider is connected (see payments). */
  priceUsdPerMonth: number | null;
  /** List price in Ethiopian birr, for the providers that charge in birr (Chapa, Telebirr). Change it here. */
  priceEtbPerMonth: number | null;
  limits: PlanLimits;
}

export const PLANS: Record<PlanName, PlanSpec> = {
  FREE: {
    name: 'FREE',
    label: 'Free',
    priceUsdPerMonth: 0,
    priceEtbPerMonth: 0,
    limits: { members: 3, sources: 1, applications: 25, aiGenerations: 10 },
  },
  PRO: {
    name: 'PRO',
    label: 'Pro',
    priceUsdPerMonth: 19,
    priceEtbPerMonth: 2500,
    limits: { members: 5, sources: 5, applications: 250, aiGenerations: 150 },
  },
  TEAM: {
    name: 'TEAM',
    label: 'Team',
    priceUsdPerMonth: 99,
    priceEtbPerMonth: 12500,
    limits: { members: 25, sources: 25, applications: 2500, aiGenerations: 1500 },
  },
  ENTERPRISE: {
    name: 'ENTERPRISE',
    label: 'Enterprise',
    priceUsdPerMonth: null,
    priceEtbPerMonth: null,
    limits: { members: null, sources: null, applications: null, aiGenerations: null },
  },
};

export const RESOURCE_LABEL: Record<QuotaResource, string> = {
  members: 'team members',
  sources: 'job sources',
  applications: 'applications this month',
  aiGenerations: 'AI-written documents this month',
};

/** Pure: would `used + adding` fit the plan's limit for this resource? */
export function fits(plan: PlanName, resource: QuotaResource, used: number, adding = 1): boolean {
  const limit = PLANS[plan].limits[resource];
  return limit === null || used + adding <= limit;
}
