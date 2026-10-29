import type { Metadata } from 'next';
import { Badge, Notice, PageHeader } from '@/components/ui';
import { api, apiOrNull, requireMe } from '@/lib/server-api';
import type { AiConnectionView, PolicySettings } from '@/lib/types';
import { AiKeyForm, PolicyForm } from './settings-forms';

export const metadata: Metadata = { title: 'Settings', robots: { index: false } };

export default async function SettingsPage() {
  const me = await requireMe();
  const canKeys = me.permissions.includes('ai_config:manage');
  const canPolicy = me.permissions.includes('organizations:manage');
  const policy = await api<PolicySettings>('/organization/policy');
  const connection = canKeys ? await apiOrNull<AiConnectionView>('/ai/connection') : null;
  return (
    <>
      <PageHeader title="Settings" subtitle={me.organization.name} />
      <div className="grid max-w-3xl gap-6">
        <section className="card space-y-3 p-4" aria-label="AI writing">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">AI writing</h2>
            <Badge tone={connection?.configured ? 'good' : 'neutral'}>
              {connection?.configured
                ? `${connection.vendor} · ${connection.model}${connection.source === 'server' ? ' (server default)' : ''}`
                : 'Not set up'}
            </Badge>
          </div>
          <p className="text-sm text-muted">
            JobPilot can draft a resume and a cover letter with an AI model, then checks every
            sentence against the candidate&rsquo;s own record. Use any provider: Groq, OpenAI,
            Anthropic, or any service that speaks the OpenAI chat protocol (OpenRouter, Together, a
            local model). Without one you can still write them yourself. The key is stored encrypted
            and is never shown again.
          </p>
          {canKeys ? (
            <AiKeyForm current={connection} />
          ) : (
            <Notice>Only an owner or administrator can change this.</Notice>
          )}
        </section>
        <section className="card space-y-3 p-4" aria-label="Review rules">
          <h2 className="text-sm font-semibold">Review rules</h2>
          <p className="text-sm text-muted">
            When an application looks risky, the person approving must acknowledge why. These rules
            say when that happens. Nothing is ever sent without a person approving it, whatever
            these are set to.
          </p>
          <PolicyForm initial={policy} canEdit={canPolicy} />
        </section>
      </div>
    </>
  );
}
