'use client';

import { useState } from 'react';
import { Field, Modal, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import type { RunResult } from '@/lib/types';

export function NewSource() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'RSS' | 'GREENHOUSE'>('RSS');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [every, setEvery] = useState('60');
  const m = useMutation();
  const key = type === 'RSS' ? 'feedUrl' : 'boardToken';
  const [company, setCompany] = useState('');
  const minutes = Number(every);
  const valid =
    name.trim() !== '' &&
    value.trim() !== '' &&
    Number.isInteger(minutes) &&
    minutes >= 5 &&
    minutes <= 10080;

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        Add a source
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a job source">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            const r = await m.run('POST', '/sources', {
              type,
              name: name.trim(),
              config: {
                [key]: value.trim(),
                ...(company.trim() ? { companyName: company.trim() } : {}),
              },
              pollIntervalMinutes: minutes,
            });
            if (r.ok) {
              setOpen(false);
              setName('');
              setValue('');
            }
          }}
        >
          <Field label="Kind">
            <select
              className="input"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              <option value="RSS">RSS or Atom feed</option>
              <option value="GREENHOUSE">Greenhouse company board</option>
            </select>
          </Field>
          <Field label="Name" error={m.fieldErrors['name']}>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={120}
            />
          </Field>
          <Field
            label={type === 'RSS' ? 'Feed address' : 'Board name'}
            hint={
              type === 'RSS'
                ? 'A public https address'
                : 'The company token in boards.greenhouse.io/<token>'
            }
            error={m.fieldErrors['config']}
          >
            <input
              className="input"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
              placeholder={type === 'RSS' ? 'https://' : 'acme'}
            />
          </Field>
          <Field
            label="Company name"
            hint="Used for jobs that do not name their employer (optional)"
          >
            <input
              className="input"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              maxLength={200}
            />
          </Field>
          <Field label="Check every (minutes)" hint="Between 5 and 10080">
            <input
              className="input"
              inputMode="numeric"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          </Field>
          {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={m.busy || !valid}>
              Add source
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function RunSource({ id }: { id: string }) {
  const m = useMutation();
  const [result, setResult] = useState<RunResult | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        className="btn"
        disabled={m.busy}
        onClick={async () => {
          setResult(null);
          const r = await m.run<RunResult>('POST', `/sources/${id}/run`, {});
          if (r.ok && r.data) setResult(r.data);
        }}
      >
        {m.busy ? 'Reading…' : 'Run now'}
      </button>
      {result ? (
        <span className="mt-1 max-w-56 text-right text-xs text-good">
          {result.created} new, {result.duplicates} known, {result.discarded} skipped,{' '}
          {result.matched} scored
        </span>
      ) : null}
      {m.error ? (
        <span className="mt-1 max-w-56 text-right text-xs text-bad">{m.error}</span>
      ) : null}
    </span>
  );
}
