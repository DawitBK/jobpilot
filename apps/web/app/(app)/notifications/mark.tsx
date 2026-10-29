'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Notice } from '@/components/ui';
import { call } from '@/lib/client-api';

export function MarkRead({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await call('POST', `/notifications/${id}/read`);
          setBusy(false);
          if (r.ok) router.refresh();
          else setError(r.message ?? 'Could not mark it as read.');
        }}
      >
        Mark read
      </button>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </>
  );
}

export function MarkAllRead() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await call('POST', '/notifications/read-all');
        setBusy(false);
        router.refresh();
      }}
    >
      Mark all read
    </button>
  );
}
