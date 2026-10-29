'use client';

import { useState } from 'react';
import { Field, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import type { PolicySettings } from '@/lib/types';

export function AiKeyForm({ hint }: { hint: string | null }) {
  const m = useMutation();
  const [value, setValue] = useState('');
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await m.run('PUT', '/secrets/anthropic_api_key', { value: value.trim() });
        if (r.ok) setValue('');
      }}
    >
      <Field
        label={hint ? `Replace the key (the stored one ends in ${hint})` : 'Anthropic API key'}
        error={m.fieldErrors['value']}
      >
        <input
          className="input font-mono"
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          minLength={8}
          required
        />
      </Field>
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={m.busy || value.trim().length < 8}>
          Save the key
        </button>
        {hint ? (
          <button
            type="button"
            className="btn text-bad"
            disabled={m.busy}
            onClick={() => {
              if (
                window.confirm('Remove the stored key? AI writing stops until a new one is saved.')
              )
                void m.run('DELETE', '/secrets/anthropic_api_key');
            }}
          >
            Remove it
          </button>
        ) : null}
      </div>
    </form>
  );
}

export function PolicyForm({ initial, canEdit }: { initial: PolicySettings; canEdit: boolean }) {
  const m = useMutation();
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(false);
  const num = (key: keyof PolicySettings, label: string, hint: string, max: number) => (
    <Field label={label} hint={hint} error={m.fieldErrors[key]}>
      <input
        className="input"
        type="number"
        min={0}
        max={max}
        disabled={!canEdit}
        value={v[key]}
        onChange={(e) => {
          setSaved(false);
          setV({ ...v, [key]: Number(e.target.value) });
        }}
      />
    </Field>
  );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await m.run('PUT', '/organization/policy', v);
        setSaved(r.ok);
      }}
    >
      {num(
        'minScoreForApproval',
        'Lowest match score without a second look',
        'Applying below this asks for acknowledgement (0 to 100)',
        100,
      )}
      {num(
        'salaryGapPercent',
        'Pay gap that needs a second look (percent)',
        'The top of the pay range this far under the minimum',
        100,
      )}
      {num(
        'maxMissingSkills',
        'Most missing skills without a second look',
        'More than this many required skills missing',
        30,
      )}
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      {saved ? <Notice tone="good">Saved.</Notice> : null}
      {canEdit ? (
        <button className="btn btn-primary" disabled={m.busy}>
          Save the rules
        </button>
      ) : (
        <p className="text-sm text-muted">Only the owner or an administrator can change these.</p>
      )}
    </form>
  );
}
