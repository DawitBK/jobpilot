import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHeader, Stat, Table, statusTone } from '@/components/ui';
import { label, timeAgo } from '@/lib/format';
import { apiOrNull, requireMe } from '@/lib/server-api';
import type { Application, Match, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

/** The states that need a person next, in the order they usually come up. */
const ACTIVE = [
  'SHORTLISTED',
  'RESUME_GENERATED',
  'COVER_LETTER_GENERATED',
  'READY_TO_APPLY',
  'NEEDS_HUMAN_REVIEW',
];
const OUT = ['APPLIED', 'SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER'];

export default async function Dashboard() {
  const me = await requireMe();
  const canJobs = me.permissions.includes('jobs:read');
  const canApps = me.permissions.includes('applications:read');
  const [apps, matches] = await Promise.all([
    canApps ? apiOrNull<Page<Application>>('/applications?limit=100') : Promise.resolve(null),
    canJobs && me.permissions.includes('candidates:read')
      ? apiOrNull<Page<Match>>('/matches?recommendation=APPLY&limit=5')
      : Promise.resolve(null),
  ]);
  const count = (states: string[]) =>
    (apps?.items ?? []).filter((a) => states.includes(a.state)).length;
  const needsYou = (apps?.items ?? []).filter(
    (a) => a.state === 'READY_TO_APPLY' || a.state === 'NEEDS_HUMAN_REVIEW',
  );

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        subtitle={me.organization.name}
      />
      {apps ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Being prepared" value={count(ACTIVE)} />
          <Stat
            label="Waiting for your approval"
            value={count(['READY_TO_APPLY'])}
            tone={count(['READY_TO_APPLY']) > 0 ? 'good' : undefined}
          />
          <Stat label="Sent and in progress" value={count(OUT)} />
          <Stat label="All applications" value={apps.page.total} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {apps ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Needs you</h2>
            {needsYou.length === 0 ? (
              <Empty>Nothing is waiting for a decision.</Empty>
            ) : (
              <Table head={['Job', 'Stage', 'Since']}>
                {needsYou.map((a) => (
                  <tr key={a.id}>
                    <td className="td">
                      <Link className="font-medium hover:underline" href={`/applications/${a.id}`}>
                        {a.jobTitle}
                      </Link>
                      <div className="text-xs text-muted">{a.companyName}</div>
                    </td>
                    <td className="td">
                      <Badge tone={statusTone(a.state)}>{label(a.state)}</Badge>
                    </td>
                    <td className="td text-muted">{timeAgo(a.stateEnteredAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        ) : null}
        {matches ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Best matches</h2>
            {matches.items.length === 0 ? (
              <Empty>
                No strong matches yet. Add job sources and complete your profile, then check back.
              </Empty>
            ) : (
              <Table head={['Job', '>Score']}>
                {matches.items.map((m) => (
                  <tr key={m.id}>
                    <td className="td">
                      <Link className="font-medium hover:underline" href={`/jobs/${m.jobId}`}>
                        {m.jobTitle}
                      </Link>
                      <div className="text-xs text-muted">{m.companyName}</div>
                    </td>
                    <td className="td text-right font-semibold tabular-nums">
                      {Math.round(m.overallScore)}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        ) : null}
      </div>
      {!apps && !matches ? (
        <Empty>
          Your role has no personal workspace here. Use the menu to see what you can do.
        </Empty>
      ) : null}
    </>
  );
}
