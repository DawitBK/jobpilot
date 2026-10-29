'use client';

import { useState } from 'react';
import { Field, useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import type { AiConnectionView, PolicySettings } from '@/lib/types';

const VENDORS = [
  { value: 'groq', label: 'Groq', model: 'openai/gpt-oss-120b' },
  { value: 'openai', label: 'OpenAI', model: 'gpt-4o-mini' },
  { value: 'anthropic', label: 'Anthropic', model: 'claude-sonnet-5-5' },
  { value: 'custom', label: 'Another OpenAI-compatible service', model: '' },
] as const;

export function AiKeyForm({ current }: { current: AiConnectionView | null }) {
  const m = useMutation();
  const [vendor, setVendor] = useState<string>(current?.vendor ?? 'groq');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(
    current?.source === 'organization' ? (current.model ?? '') : '',
  );
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '');
  const [tested, setTested] = useState<string | null>(null);
  const own = current?.source === 'organization';
  const chosen = VENDORS.find((v) => v.value === vendor)!;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setTested(null);
        const r = await m.run('PUT', '/ai/connection', {
          vendor,
          apiKey: apiKey.trim(),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(vendor === 'custom' && baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        });
        if (r.ok) setApiKey('');
      }}
    >
      <Field label="Provider">
        <select className="input" value={vendor} onChange={(e) => setVendor(e.target.value)}>
          {VENDORS.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label}
            </option>
          ))}
        </select>
      </Field>
      <Field
        label="Model"
        hint={chosen.model ? `Leave empty for ${chosen.model}` : 'The model name your service uses'}
      >
        <input
          className="input font-mono"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </Field>
      {vendor === 'custom' ? (
        <Field
          label="Address of the service"
          hint="Its base address, for example https://openrouter.ai/api/v1"
          error={m.fieldErrors['baseUrl']}
        >
          <input
            className="input font-mono"
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            required
          />
        </Field>
      ) : null}
      <Field
        label={
          own && current?.hint ? `API key (the stored one ends in ${current.hint})` : 'API key'
        }
        error={m.fieldErrors['apiKey']}
      >
        <input
          className="input font-mono"
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          minLength={8}
          required
        />
      </Field>
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
      {tested ? <Notice tone="good">{tested}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={m.busy || apiKey.trim().length < 8}>
          Save the connection
        </button>
        {current?.configured ? (
          <button
            type="button"
            className="btn"
            disabled={m.busy}
            onClick={async () => {
              setTested(null);
              const r = await m.run<{ vendor: string; model: string; milliseconds: number }>(
                'POST',
                '/ai/connection/test',
                {},
                { refresh: false },
              );
              if (r.ok && r.data)
                setTested(`It works: ${r.data.model} answered in ${r.data.milliseconds} ms.`);
            }}
          >
            Test it
          </button>
        ) : null}
        {own ? (
          <button
            type="button"
            className="btn text-bad"
            disabled={m.busy}
            onClick={() => {
              if (
                window.confirm(
                  'Remove the saved connection? AI writing stops (or falls back to the server default) until a new one is saved.',
                )
              )
                void m.run('DELETE', '/ai/connection');
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
