import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { label, timeAgo } from '@/lib/format';
import { api, qs } from '@/lib/server-api';
import type { Application, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Applications', robots: { index: false } };

const STATES = [
  'MATCHED',
  'SHORTLISTED',
  'RESUME_GENERATED',
  'COVER_LETTER_GENERATED',
  'READY_TO_APPLY',
  'NEEDS_HUMAN_REVIEW',
  'APPROVED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'FINAL_INTERVIEW',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'NO_RESPONSE',
  'EXPIRED',
];

export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; offset?: string }>;
}) {
  const sp = await searchParams;
  const state = STATES.includes(sp.state ?? '') ? sp.state : undefined;
  const data = await api<Page<Application>>(
    `/applications${qs({ state, offset: num(sp.offset), limit: 20 })}`,
  );
  return (
    <>
      <PageHeader title="Applications" subtitle={`${data.page.total} applications`} />
      <form className="no-print mb-4 flex items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Stage</span>
          <select className="input" name="state" defaultValue={state ?? ''}>
            <option value="">All</option>
            {STATES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No applications yet. Start one from a job, or from your best matches.</Empty>
      ) : (
        <Table head={['Job', 'Stage', 'Since']}>
          {data.items.map((a) => (
            <tr key={a.id} className="hover:bg-surface">
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
      <Pager page={data.page} path="/applications" params={{ state }} />
    </>
  );
}
