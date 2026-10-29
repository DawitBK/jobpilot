import type { Metadata } from 'next';
import { Badge, Notice, PageHeader } from '@/components/ui';
import { api, requireMe } from '@/lib/server-api';
import type { MfaStatus } from '@/lib/types';
import { TwoStep } from './two-step';

export const metadata: Metadata = { title: 'Security', robots: { index: false } };

export default async function SecurityPage() {
  const me = await requireMe();
  const status = await api<MfaStatus>('/me/mfa');
  return (
    <>
      <PageHeader
        title="Security"
        subtitle={`Signed in as ${me.user.email}.`}
        actions={
          <Badge tone={status.enabled ? 'good' : 'warn'}>
            {status.enabled ? 'Two-step sign-in is on' : 'Two-step sign-in is off'}
          </Badge>
        }
      />
      <section className="card max-w-2xl space-y-4 p-4" aria-label="Two-step sign-in">
        <h2 className="text-sm font-semibold">Two-step sign-in</h2>
        <p className="text-sm text-muted">
          After your password, JobPilot asks for a six-digit code from an authenticator app (any app
          that supports time-based codes). A stolen password alone is then not enough.
        </p>
        {!status.available ? (
          <Notice tone="bad">
            This server has no encryption key configured, so two-step sign-in cannot be stored. Ask
            the administrator to set SECRETS_KEY.
          </Notice>
        ) : (
          <TwoStep enabled={status.enabled} recoveryCodesLeft={status.recoveryCodesLeft} />
        )}
      </section>
    </>
  );
}
