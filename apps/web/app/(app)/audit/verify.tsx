'use client';

import { useState } from 'react';
import { call } from '@/lib/client-api';
import { Notice } from '@/components/ui';

interface Result {
  valid: boolean;
  checked: number;
  brokenAt: number | null;
}

/** Recomputes the whole hash chain on the server and says whether every entry still holds. */
export function VerifyChain() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-2">
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await call<Result>('GET', '/audit/verify');
          setBusy(false);
          if (r.ok && r.data) setResult(r.data);
          else setError(r.message ?? 'Could not check the chain.');
        }}
      >
        {busy ? 'Checking…' : 'Verify the chain'}
      </button>
      {result ? (
        <Notice tone={result.valid ? 'good' : 'bad'}>
          {result.valid
            ? `All ${result.checked} entries hold: nothing was changed or removed.`
            : `Entry ${result.brokenAt} does not match its hash: the trail was altered there.`}
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </div>
  );
}
