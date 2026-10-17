'use client';

import { useState } from 'react';
import { useMutation } from '@/components/form';
import { Notice } from '@/components/ui';

export function Rescore({ candidateProfileId }: { candidateProfileId?: string }) {
  const m = useMutation();
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        className="btn"
        disabled={m.busy}
        onClick={async () => {
          setDone(false);
          const r = await m.run(
            'POST',
            '/matches/rescore',
            candidateProfileId ? { candidateProfileId } : {},
          );
          if (r.ok) setDone(true);
        }}
      >
        {m.busy ? 'Scoring…' : 'Rescore all jobs'}
      </button>
      {done && !m.error ? <span className="text-xs text-good">Scores updated.</span> : null}
      {m.error ? (
        <div className="max-w-64">
          <Notice tone="bad">{m.error}</Notice>
        </div>
      ) : null}
    </span>
  );
}
