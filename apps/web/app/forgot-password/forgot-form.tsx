'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/ui';
import { requestReset, type ForgotState } from './actions';

export function ForgotForm() {
  const [state, run, pending] = useActionState<ForgotState, FormData>(requestReset, {});
  if (state.done) {
    return (
      <div className="card space-y-4 p-5">
        <Notice tone="good">
          If that address has a JobPilot account, a link to choose a new password is on its way. It
          works for one hour.
        </Notice>
        <p className="text-sm text-muted">
          Nothing arrived? Check the spam folder, or ask again in a few minutes.
        </p>
        <Link className="btn w-full text-center" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={run} className="card space-y-4 p-5">
      <Field label="Email">
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          autoFocus
          required
        />
      </Field>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Please wait…' : 'Send me a link'}
      </button>
      <p className="text-center text-sm">
        <Link className="text-brand hover:underline" href="/login">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
