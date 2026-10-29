'use client';

import { Notice } from '@/components/ui';
import { useMutation } from '@/components/form';
import type { PlanSpec } from '@/lib/types';

const fmt = (n: number | null) => (n === null ? 'Unlimited' : n.toLocaleString('en-GB'));

export function PlanPicker({
  current,
  plans,
  canChange,
}: {
  current: PlanSpec['name'];
  plans: PlanSpec[];
  canChange: boolean;
}) {
  const m = useMutation();
  return (
    <section aria-label="Plans">
      <h2 className="mb-3 text-sm font-semibold">Plans</h2>
      {m.error ? (
        <div className="mb-3">
          <Notice tone="bad">{m.error}</Notice>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((p) => (
          <div key={p.name} className={`card p-4 ${p.name === current ? 'border-brand' : ''}`}>
            <div className="flex items-baseline justify-between">
              <h3 className="font-semibold">{p.label}</h3>
              <span className="text-sm text-muted">
                {p.priceUsdPerMonth === null
                  ? 'Custom'
                  : p.priceUsdPerMonth === 0
                    ? 'Free'
                    : `$${p.priceUsdPerMonth}/month`}
              </span>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-muted">
              <li>{fmt(p.limits.members)} team members</li>
              <li>{fmt(p.limits.sources)} job sources</li>
              <li>{fmt(p.limits.applications)} applications a month</li>
              <li>{fmt(p.limits.aiGenerations)} AI documents a month</li>
            </ul>
            {p.name === current ? (
              <p className="mt-3 text-sm font-medium text-brand">Your plan</p>
            ) : (
              <button
                className="btn mt-3 w-full"
                disabled={!canChange || m.busy}
                onClick={() => {
                  if (window.confirm(`Change the plan to ${p.label}?`))
                    void m.run('PUT', '/billing/plan', { plan: p.name });
                }}
              >
                Switch to {p.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
