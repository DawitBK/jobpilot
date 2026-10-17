'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Notice } from '@/components/ui';
import { chooseOrganization, type AuthState } from './actions';

type Action = (prev: AuthState, form: FormData) => Promise<AuthState>;

export function AuthForm({
  mode,
  action,
  next,
}: {
  mode: 'login' | 'register';
  action: Action;
  next?: string;
}) {
  const [state, run, pending] = useActionState<AuthState, FormData>(action, {});
  const [chosen, choose, choosing] = useActionState<AuthState, FormData>(chooseOrganization, {});
  const err = state.fieldErrors ?? {};
  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';

  if (state.choice) {
    return (
      <form action={choose} className="card space-y-4 p-5">
        <input type="hidden" name="next" value={next ?? ''} />
        <input type="hidden" name="selectionToken" value={state.choice.selectionToken} />
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Which organization?</legend>
          <div className="space-y-2">
            {state.choice.organizations.map((o, i) => (
              <label
                key={o.id}
                className="flex cursor-pointer items-center justify-between rounded-md border border-line px-3 py-2 text-sm hover:bg-surface"
              >
                <span className="flex items-center gap-2">
                  <input type="radio" name="organizationId" value={o.id} defaultChecked={i === 0} />
                  {o.name}
                </span>
                <span className="text-xs text-muted">{o.role.toLowerCase()}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {chosen.error ? <Notice tone="bad">{chosen.error}</Notice> : null}
        <button className="btn btn-primary w-full" disabled={choosing}>
          {choosing ? 'Please wait…' : 'Continue'}
        </button>
      </form>
    );
  }

  return (
    <form action={run} className="card space-y-4 p-5">
      <input type="hidden" name="next" value={next ?? ''} />
      {mode === 'register' ? (
        <Field name="fullName" label="Full name" error={err['fullName']} autoComplete="name" />
      ) : null}
      <Field name="email" label="Email" type="email" error={err['email']} autoComplete="username" />
      <Field
        name="password"
        label="Password"
        type="password"
        error={err['password']}
        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
        hint={
          mode === 'register' ? 'At least 12 characters. A short sentence works well.' : undefined
        }
      />
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <p className="text-center text-sm text-muted">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <Link className="text-brand hover:underline" href={`/register${suffix}`}>
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <Link className="text-brand hover:underline" href={`/login${suffix}`}>
              Sign in
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  name,
  label,
  type = 'text',
  error,
  hint,
  autoComplete,
}: {
  name: string;
  label: string;
  type?: string;
  error?: string;
  hint?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      <input
        className="input"
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
      />
      {hint && !error ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : null}
    </label>
  );
}
