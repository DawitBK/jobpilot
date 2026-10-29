'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import { label } from '@/lib/format';
import type { Review } from '@/lib/types';

/**
 * Approval is the one step nothing else may take. It is its own card, with its own words, so it is
 * never a button among buttons.
 */
export function ApprovalCard({
  applicationId,
  review,
}: {
  applicationId: string;
  review: Review | null;
}) {
  const m = useMutation();
  const [read, setRead] = useState(false);
  const needsAck = review?.requiresAcknowledgement ?? false;
  return (
    <section className="card border-good p-4" aria-label="Approval">
      <h2 className="text-sm font-semibold">Ready for your decision</h2>
      <p className="mt-1 text-sm text-muted">
        Approving says you have read this application and it may be sent. Only a person can do this;
        no automation can approve for you. Your name and the time are recorded.
      </p>
      {needsAck && review ? (
        <div className="mt-3 rounded-md border border-bad/40 bg-bad/5 p-3 text-sm">
          <p className="font-medium text-bad">Read this first: it is rated high risk.</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {review.reasons.map((r, i) => (
              <li key={i}>{r.text}</li>
            ))}
          </ul>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={read}
              onChange={(e) => setRead(e.target.checked)}
              className="mt-1"
            />
            <span>
              I have read this and still want to approve. It will be recorded with my name.
            </span>
          </label>
        </div>
      ) : null}
      {m.error ? (
        <div className="mt-2">
          <Notice tone="bad">{m.error}</Notice>
        </div>
      ) : null}
      <button
        className="btn btn-primary mt-3 w-full"
        disabled={m.busy || (needsAck && !read)}
        onClick={() => {
          if (window.confirm('Approve this application?'))
            void m.run(
              'POST',
              `/applications/${applicationId}/approve`,
              needsAck ? { acknowledgeRisks: true } : {},
            );
        }}
      >
        {m.busy ? 'Approving…' : 'Approve this application'}
      </button>
    </section>
  );
}

const DANGER = new Set(['REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'EXPIRED']);

export function Transitions({
  applicationId,
  states,
}: {
  applicationId: string;
  states: string[];
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const m = useMutation();
  return (
    <section className="card p-4" aria-label="Move this application">
      <h2 className="mb-2 text-sm font-semibold">Move it to</h2>
      <div className="flex flex-wrap gap-2">
        {states.map((s) => (
          <button
            key={s}
            className={`btn ${DANGER.has(s) ? 'text-bad' : ''}`}
            onClick={() => setTarget(s)}
          >
            {label(s)}
          </button>
        ))}
      </div>
      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`Move to ${target ? label(target) : ''}`}
      >
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await m.run('POST', `/applications/${applicationId}/transition`, {
              to: target,
              ...(note.trim() ? { note: note.trim() } : {}),
            });
            if (r.ok) {
              setTarget(null);
              setNote('');
            }
          }}
        >
          <Field label="Note (optional)" hint="Kept on the timeline" error={m.fieldErrors['note']}>
            <textarea
              className="input min-h-20 py-2"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setTarget(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy}>
              Move
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
