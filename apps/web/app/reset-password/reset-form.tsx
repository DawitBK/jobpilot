'use client';

import { useActionState, useState } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/ui';
import { resetPassword, type ResetState } from './actions';

export function ResetForm({ token }: { token: string }) {
  const [state, run, pending] = useActionState<ResetState, FormData>(resetPassword, {});
  const err = state.fieldErrors ?? {};
  // Controlled, so a mismatch or a refused password does not empty the fields (a form action resets uncontrolled ones).
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  return (
    <form action={run} className="card space-y-4 p-5">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 12 characters." error={err['password']}>
        <input
          className="input"
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          autoFocus
          required
        />
      </Field>
      <Field label="New password again" error={err['again']}>
        <input
          className="input"
          name="again"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      {state.error ? <Notice tone="bad">{state.error}</Notice> : null}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? 'Please wait…' : 'Set the new password'}
      </button>
    </form>
  );
}
