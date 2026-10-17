'use client';

import { useRouter } from 'next/navigation';
import { useMutation } from '@/components/form';
import { Notice } from '@/components/ui';
import type { Application } from '@/lib/types';

export function StartApplication({
  jobId,
  candidateProfileId,
  blocked,
}: {
  jobId: string;
  candidateProfileId: string;
  blocked: boolean;
}) {
  const router = useRouter();
  const m = useMutation();
  return (
    <div className="space-y-2">
      <button
        className="btn btn-primary w-full"
        disabled={m.busy}
        onClick={async () => {
          const r = await m.run<Application>(
            'POST',
            '/applications',
            { jobId, candidateProfileId },
            { refresh: false },
          );
          if (r.ok && r.data) router.push(`/applications/${r.data.id}`);
        }}
      >
        {blocked ? 'Track it anyway' : 'Start an application'}
      </button>
      {blocked ? (
        <p className="text-xs text-muted">
          This job is ruled out for you. You can still track it, but it will not be suggested.
        </p>
      ) : null}
      {m.error ? <Notice tone="bad">{m.error}</Notice> : null}
    </div>
  );
}
