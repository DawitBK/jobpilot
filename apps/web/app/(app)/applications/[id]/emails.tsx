'use client';

import { useState } from 'react';
import { Field, useMutation } from '@/components/form';
import { Badge, Notice, statusTone } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import type { EmailItem } from '@/lib/types';

const KIND: Record<string, string> = {
  INTERVIEW_INVITE: 'Interview invitation',
  ASSESSMENT: 'Assessment',
  OFFER: 'Offer',
  REJECTION: 'Rejection',
  RECEIPT: 'Application received',
  OTHER: 'Not sure',
};

function Row({
  applicationId,
  email,
  canWrite,
}: {
  applicationId: string;
  email: EmailItem;
  canWrite: boolean;
}) {
  const m = useMutation();
  return (
    <li className="rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{email.subject}</span>
        <Badge
          tone={
            email.classification === 'REJECTION'
              ? 'bad'
              : email.classification === 'OTHER'
                ? 'neutral'
                : 'info'
          }
        >
          {KIND[email.classification] ?? email.classification}
        </Badge>
        <span className="text-xs text-muted">
          from {email.fromAddress} · {formatDateTime(email.receivedAt)} · confidence{' '}
          {Math.round(email.confidence * 100)}%
        </span>
      </div>
      {email.signals.length > 0 ? (
        <p className="mt-1 text-xs text-muted">Based on: {email.signals.join(', ')}</p>
      ) : null}
      <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-muted">{email.body}</p>
      {email.status === 'NEW' && email.suggestedState && canWrite ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span>
            Suggested: move to{' '}
            <Badge tone={statusTone(email.suggestedState)}>{label(email.suggestedState)}</Badge>
          </span>
          <button
            className="btn btn-primary"
            disabled={m.busy}
            onClick={() =>
              void m.run('POST', `/applications/${applicationId}/emails/${email.id}/apply`, {})
            }
          >
            Move it
          </button>
          <button
            className="btn"
            disabled={m.busy}
            onClick={() =>
              void m.run('POST', `/applications/${applicationId}/emails/${email.id}/dismiss`, {})
            }
          >
            Ignore
          </button>
        </div>
      ) : null}
      {email.status === 'NEW' && !email.suggestedState && canWrite ? (
        <div className="mt-2">
          <button
            className="btn"
            disabled={m.busy}
            onClick={() =>
              void m.run('POST', `/applications/${applicationId}/emails/${email.id}/dismiss`, {})
            }
          >
            Mark as dealt with
          </button>
        </div>
      ) : null}
      {email.status !== 'NEW' ? (
        <p className="mt-2 text-xs text-muted">
          {email.status === 'ACTED' ? 'You moved the application on this email.' : 'Dealt with.'}
        </p>
      ) : null}
      {m.error ? (
        <div className="mt-2">
          <Notice tone="bad">{m.error}</Notice>
        </div>
      ) : null}
    </li>
  );
}

export function Emails({
  applicationId,
  emails,
  canWrite,
}: {
  applicationId: string;
  emails: EmailItem[];
  canWrite: boolean;
}) {
  const m = useMutation();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ fromAddress: '', subject: '', body: '' });
  return (
    <section className="card space-y-3 p-4" aria-label="Employer emails">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Employer emails</h2>
        {canWrite ? (
          <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            Log an email
          </button>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Paste a reply from the employer. JobPilot reads it and suggests the next step; the
        application only moves when you say so.
      </p>
      {open ? (
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run('POST', `/applications/${applicationId}/emails`, v);
            if (r.ok) {
              setV({ fromAddress: '', subject: '', body: '' });
              setOpen(false);
            }
          }}
        >
          <Field label="From (email address)" error={m.fieldErrors['fromAddress']}>
            <input
              className="input"
              type="email"
              value={v.fromAddress}
              onChange={(e) => setV({ ...v, fromAddress: e.target.value })}
              required
            />
          </Field>
          <Field label="Subject" error={m.fieldErrors['subject']}>
            <input
              className="input"
              value={v.subject}
              onChange={(e) => setV({ ...v, subject: e.target.value })}
              maxLength={300}
              required
            />
          </Field>
          <Field label="The email" error={m.fieldErrors['body']}>
            <textarea
              className="input min-h-32 py-2"
              value={v.body}
              onChange={(e) => setV({ ...v, body: e.target.value })}
              maxLength={20000}
              required
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <button className="btn btn-primary" disabled={m.busy}>
            Read it
          </button>
        </form>
      ) : null}
      {emails.length === 0 ? (
        <p className="text-sm text-muted">No emails logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {emails.map((e) => (
            <Row key={e.id} applicationId={applicationId} email={e} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </section>
  );
}
