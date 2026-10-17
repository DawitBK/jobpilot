import type { Metadata } from 'next';
import Link from 'next/link';
import { MatchBreakdown } from '@/components/match-card';
import { Empty, PageHeader, Pager, num } from '@/components/ui';
import { api, apiOrNull, qs, requireMe } from '@/lib/server-api';
import type { Match, Page, Profile } from '@/lib/types';
import { Rescore } from './rescore';

export const metadata: Metadata = { title: 'Matches', robots: { index: false } };

export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ recommendation?: string; minScore?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireMe();
  const rec = ['APPLY', 'MAYBE', 'SKIP'].includes(sp.recommendation ?? '')
    ? sp.recommendation
    : undefined;
  const profile = me.permissions.includes('candidates:read')
    ? await apiOrNull<Profile>('/candidates/me')
    : null;
  const data = await api<Page<Match>>(
    `/matches${qs({
      recommendation: rec,
      minScore: sp.minScore,
      candidateProfileId: profile?.id,
      offset: num(sp.offset),
      limit: 10,
    })}`,
  );
  return (
    <>
      <PageHeader
        title="Matches"
        subtitle="Every job scored against your profile, best first. The parts of each score are shown."
        actions={
          me.permissions.includes('candidates:write') ? (
            <Rescore candidateProfileId={profile?.id} />
          ) : null
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Show</span>
          <select className="input" name="recommendation" defaultValue={rec ?? ''}>
            <option value="">All</option>
            <option value="APPLY">Worth applying</option>
            <option value="MAYBE">Maybe</option>
            <option value="SKIP">Skip</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Score at least</span>
          <input
            className="input w-24"
            name="minScore"
            inputMode="numeric"
            defaultValue={sp.minScore}
          />
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>
          No matches yet. They appear when jobs arrive and your profile has skills.{' '}
          <Link className="text-brand hover:underline" href="/profile">
            Complete your profile
          </Link>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {data.items.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="mb-3">
                <Link className="font-medium hover:underline" href={`/jobs/${m.jobId}`}>
                  {m.jobTitle}
                </Link>
                <span className="text-sm text-muted"> · {m.companyName}</span>
              </div>
              <MatchBreakdown match={m} />
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={data.page}
        path="/matches"
        params={{ recommendation: rec, minScore: sp.minScore }}
      />
    </>
  );
}
