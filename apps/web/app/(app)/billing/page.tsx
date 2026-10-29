import type { Metadata } from 'next';
import { Badge, Notice, PageHeader } from '@/components/ui';
import { api, requireMe } from '@/lib/server-api';
import type { Billing } from '@/lib/types';
import { PlanPicker } from './plan-picker';

export const metadata: Metadata = { title: 'Plan and usage', robots: { index: false } };

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const tone = limit !== null && used >= limit ? 'bg-bad' : pct >= 80 ? 'bg-warn' : 'bg-brand';
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="capitalize">{label}</span>
        <span className="tabular-nums text-muted">
          {used} of {limit === null ? 'unlimited' : limit}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded-full bg-surface"
        role="progressbar"
        aria-label={label}
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
      >
        <div className={`h-full ${tone}`} style={{ width: limit === null ? '4%' : `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function BillingPage() {
  const me = await requireMe();
  const billing = await api<Billing>('/billing');
  const canChange = me.permissions.includes('billing:manage');
  return (
    <>
      <PageHeader
        title="Plan and usage"
        subtitle={`${me.organization.name} is on the ${billing.plans.find((p) => p.name === billing.plan)?.label} plan.`}
        actions={<Badge tone="info">{billing.plan}</Badge>}
      />
      {!billing.payment.connected ? (
        <div className="mb-4">
          <Notice>{billing.payment.note}</Notice>
        </div>
      ) : null}
      <section className="card mb-6 space-y-4 p-4" aria-label="Usage">
        <h2 className="text-sm font-semibold">What you are using</h2>
        {billing.quotas.map((q) => (
          <Meter key={q.resource} label={q.label} used={q.used} limit={q.limit} />
        ))}
      </section>
      <PlanPicker current={billing.plan} plans={billing.plans} canChange={canChange} />
      {!canChange ? (
        <p className="mt-3 text-sm text-muted">
          Only the owner of the organization can change the plan.
        </p>
      ) : null}
    </>
  );
}
