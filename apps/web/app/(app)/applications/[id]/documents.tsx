'use client';

import { useState } from 'react';
import { Field, useMutation } from '@/components/form';
import { Badge, Notice } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import type { DocumentItem, DocumentsResponse } from '@/lib/types';

const VERDICT_TONE = {
  SUPPORTED: 'good',
  UNSUPPORTED: 'bad',
  CONFLICTING: 'bad',
  UNKNOWN: 'neutral',
} as const;
const VERDICT_TEXT = {
  SUPPORTED: 'Backed by the record',
  UNSUPPORTED: 'Not in the record',
  CONFLICTING: 'Contradicts the record',
  UNKNOWN: 'Nothing to check',
} as const;

function Doc({ doc }: { doc: DocumentItem }) {
  const [open, setOpen] = useState(false);
  const bad = (doc.verdicts['UNSUPPORTED'] ?? 0) + (doc.verdicts['CONFLICTING'] ?? 0);
  return (
    <div className="rounded-md border border-line p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{doc.kind === 'RESUME' ? 'Resume' : 'Cover letter'}</span>
        <span className="text-xs text-muted">
          version {doc.version} ·{' '}
          {doc.provider === 'manual' ? 'written by a person' : `written by AI (${doc.model})`} ·{' '}
          {formatDateTime(doc.createdAt)}
        </span>
        {doc.needsReview ? <Badge tone="bad">Stopped for review</Badge> : null}
        {bad > 0 ? (
          <Badge tone="bad">
            {bad} statement{bad === 1 ? '' : 's'} not backed
          </Badge>
        ) : null}
        {doc.verdicts['SUSPECTED_INJECTION'] ? (
          <Badge tone="warn">Hidden instructions found in the posting</Badge>
        ) : null}
      </div>
      <pre
        className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap font-sans"
        data-testid={`doc-${doc.kind}`}
      >
        {doc.content}
      </pre>
      {doc.claims.length > 0 ? (
        <div className="mt-2">
          <button
            className="text-brand hover:underline"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
          >
            {open ? 'Hide the check' : 'Show how each statement was checked'}
          </button>
          {open ? (
            <ul className="mt-2 space-y-2">
              {doc.claims.map((c, i) => (
                <li key={i} className="rounded bg-surface p-2">
                  <Badge tone={VERDICT_TONE[c.verdict]}>{VERDICT_TEXT[c.verdict]}</Badge>
                  <span className="ml-2">{c.text}</span>
                  <p className="mt-1 text-xs text-muted">{c.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function Documents({
  applicationId,
  state,
  data,
  canWrite,
}: {
  applicationId: string;
  state: string;
  data: DocumentsResponse;
  canWrite: boolean;
}) {
  const m = useMutation();
  const [manual, setManual] = useState<'RESUME' | 'COVER_LETTER' | null>(null);
  const [text, setText] = useState('');
  const hasResume = data.latest.some((d) => d.kind === 'RESUME');
  const canResume = [
    'SHORTLISTED',
    'RESUME_GENERATED',
    'COVER_LETTER_GENERATED',
    'NEEDS_HUMAN_REVIEW',
  ].includes(state);
  const canLetter =
    hasResume &&
    ['RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'NEEDS_HUMAN_REVIEW'].includes(state);
  return (
    <section className="card space-y-3 p-4" aria-label="Documents">
      <h2 className="text-sm font-semibold">Documents</h2>
      {data.latest.length === 0 ? (
        <p className="text-sm text-muted">
          {canResume
            ? 'Nothing written yet.'
            : `Documents are written once the application is shortlisted (it is ${label(state)} now).`}
        </p>
      ) : (
        data.latest.map((d) => <Doc key={d.id} doc={d} />)
      )}
      {canWrite && (canResume || canLetter) ? (
        <div className="space-y-2 border-t border-line pt-3">
          {!data.ai.available ? (
            <Notice>
              AI writing is not set up for this organization, so you write the documents yourself.
              An owner can add a key in Settings.
            </Notice>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {data.ai.available && canResume ? (
              <button
                className="btn btn-primary"
                disabled={m.busy}
                onClick={() =>
                  void m.run('POST', `/applications/${applicationId}/documents/generate`, {
                    kind: 'RESUME',
                  })
                }
              >
                {m.busy
                  ? 'Writing…'
                  : hasResume
                    ? 'Write the resume again with AI'
                    : 'Write the resume with AI'}
              </button>
            ) : null}
            {data.ai.available && canLetter ? (
              <button
                className="btn btn-primary"
                disabled={m.busy}
                onClick={() =>
                  void m.run('POST', `/applications/${applicationId}/documents/generate`, {
                    kind: 'COVER_LETTER',
                  })
                }
              >
                {m.busy ? 'Writing…' : 'Write the cover letter with AI'}
              </button>
            ) : null}
            {canResume ? (
              <button
                className="btn"
                onClick={() => {
                  setManual('RESUME');
                  setText('');
                }}
              >
                Write the resume myself
              </button>
            ) : null}
            {canLetter ? (
              <button
                className="btn"
                onClick={() => {
                  setManual('COVER_LETTER');
                  setText('');
                }}
              >
                Write the cover letter myself
              </button>
            ) : null}
          </div>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          {manual ? (
            <form
              className="space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                const r = await m.run('POST', `/applications/${applicationId}/documents/manual`, {
                  kind: manual,
                  content: text.trim(),
                });
                if (r.ok) setManual(null);
              }}
            >
              <Field
                label={manual === 'RESUME' ? 'Your resume' : 'Your cover letter'}
                error={m.fieldErrors['content']}
              >
                <textarea
                  className="input min-h-40 py-2"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  minLength={20}
                  maxLength={12000}
                  required
                />
              </Field>
              <div className="flex gap-2">
                <button className="btn btn-primary" disabled={m.busy || text.trim().length < 20}>
                  Save
                </button>
                <button type="button" className="btn" onClick={() => setManual(null)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
