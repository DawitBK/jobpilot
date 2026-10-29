'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/ui';
import { call } from '@/lib/client-api';

type Step =
  | { name: 'idle' }
  | { name: 'scan'; secret: string; otpauthUrl: string }
  | { name: 'codes'; codes: string[] };

export function TwoStep({
  enabled,
  recoveryCodesLeft,
}: {
  enabled: boolean;
  recoveryCodesLeft: number;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ name: 'idle' });
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => ReturnType<typeof call<T>>, then: (data?: T) => void) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) then(r.data);
    else setError(r.message ?? 'Something went wrong.');
  }

  if (step.name === 'codes') {
    return (
      <div className="space-y-3">
        <Notice tone="good">Two-step sign-in is on.</Notice>
        <p className="text-sm">
          <strong>Save these recovery codes now.</strong> Each one works once if you lose your
          phone. They are shown only this time.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Recovery codes">
          {step.codes.map((c) => (
            <li key={c} className="rounded border border-line bg-surface px-2 py-1">
              {c}
            </li>
          ))}
        </ul>
        <button
          className="btn btn-primary"
          onClick={() => {
            setStep({ name: 'idle' });
            router.refresh();
          }}
        >
          I have saved them
        </button>
      </div>
    );
  }

  if (step.name === 'scan') {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(
            () => call<{ recoveryCodes: string[] }>('POST', '/me/mfa/enable', { code }),
            (data) => {
              setCode('');
              setStep({ name: 'codes', codes: data?.recoveryCodes ?? [] });
            },
          );
        }}
      >
        <p className="text-sm">
          In your authenticator app choose &ldquo;add an account&rdquo; and enter this key (or open
          the link on your phone):
        </p>
        <p
          className="rounded border border-line bg-surface px-3 py-2 font-mono text-sm break-all"
          data-testid="mfa-secret"
        >
          {step.secret}
        </p>
        <a className="text-sm text-brand hover:underline" href={step.otpauthUrl}>
          Open in an authenticator app
        </a>
        <Field label="Then enter the six-digit code it shows" error={undefined}>
          <input
            className="input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            Turn on
          </button>
          <button type="button" className="btn" onClick={() => setStep({ name: 'idle' })}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  if (!enabled) {
    return (
      <div className="space-y-3">
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void run(
              () => call<{ secret: string; otpauthUrl: string }>('POST', '/me/mfa/setup'),
              (data) =>
                data && setStep({ name: 'scan', secret: data.secret, otpauthUrl: data.otpauthUrl }),
            )
          }
        >
          Set up two-step sign-in
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        {recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? '' : 's'} left.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!window.confirm('Turn off two-step sign-in?')) return;
          void run(
            () => call('POST', '/me/mfa/disable', { password, code }),
            () => {
              setPassword('');
              setCode('');
              router.refresh();
            },
          );
        }}
      >
        <h3 className="text-sm font-semibold">Turn it off</h3>
        <Field label="Your password">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field label="A current code from your app">
          <input
            className="input"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            required
          />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <button className="btn text-bad" disabled={busy || code.length !== 6 || !password}>
          Turn off
        </button>
      </form>
    </div>
  );
}
