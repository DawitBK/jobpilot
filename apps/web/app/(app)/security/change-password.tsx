'use client';

import { useState } from 'react';
import { Field } from '@/components/form';
import { Notice } from '@/components/ui';
import { call } from '@/lib/client-api';
import { endSessionsAfterPasswordChange } from '@/app/login/actions';

export function ChangePassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});

  async function submit(form: FormData) {
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    const again = String(form.get('again') ?? '');
    setError(null);
    if (newPassword.length < 12)
      return setFieldError({ newPassword: 'Use at least 12 characters.' });
    if (newPassword !== again)
      return setFieldError({ again: 'The two passwords are not the same.' });
    setFieldError({});
    setBusy(true);
    const r = await call('POST', '/me/password', { currentPassword, newPassword });
    if (r.ok) return endSessionsAfterPasswordChange();
    setBusy(false);
    if (r.status === 401) setFieldError({ currentPassword: 'That is not your current password.' });
    else if (r.status === 409) {
      setError(
        'This account signs in through the identity provider: its password is changed there.',
      );
    } else setError(r.message ?? 'Something went wrong. Try again.');
  }

  return (
    // A submit handler rather than a form action: a form action empties the fields afterwards, and a wrong current password must not cost the person what they typed.
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(new FormData(event.currentTarget));
      }}
      className="max-w-sm space-y-3"
    >
      <Field label="Current password" error={fieldError['currentPassword']}>
        <input
          className="input"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" hint="At least 12 characters." error={fieldError['newPassword']}>
        <input
          className="input"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      <Field label="New password again" error={fieldError['again']}>
        <input
          className="input"
          name="again"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
        />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Please wait…' : 'Change password'}
      </button>
    </form>
  );
}
