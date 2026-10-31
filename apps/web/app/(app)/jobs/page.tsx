import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, Table, num, statusTone } from '@/components/ui';
import { label, salaryRange, timeAgo } from '@/lib/format';
import { api, qs, requireMe } from '@/lib/server-api';
import type { Job, Page } from '@/lib/types';
import { ImportLinks } from '../sources/source-forms';
import { NewJob } from './new-job';

export const metadata: Metadata = { title: 'Jobs', robots: { index: false } };

type Search = { q?: string; remoteType?: string; status?: string; skill?: string; offset?: string };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const me = await requireMe();
  const data = await api<Page<Job>>(
    `/jobs${qs({ q: sp.q, remoteType: sp.remoteType, status: sp.status, skill: sp.skill, offset: num(sp.offset), limit: 20 })}`,
  );
  return (
    <>
      <PageHeader
        title="Jobs"
        subtitle={`${data.page.total} jobs`}
        actions={
          me.permissions.includes('jobs:write') ? (
            <>
              <ImportLinks />
              <NewJob />
            </>
          ) : null
        }
      />
      <form className="no-print mb-4 flex flex-wrap items-end gap-2" method="get">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Search</span>
          <input
            className="input"
            name="q"
            defaultValue={sp.q}
            placeholder="Title, company or text"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Skill</span>
          <input
            className="input"
            name="skill"
            defaultValue={sp.skill}
            placeholder="e.g. TypeScript"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Where</span>
          <select className="input" name="remoteType" defaultValue={sp.remoteType ?? ''}>
            <option value="">Anywhere</option>
            <option value="REMOTE">Remote</option>
            <option value="HYBRID">Hybrid</option>
            <option value="ONSITE">On site</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Status</span>
          <select className="input" name="status" defaultValue={sp.status ?? ''}>
            <option value="">Any</option>
            <option value="ACTIVE">Open</option>
            <option value="EXPIRED">Expired</option>
            <option value="CLOSED">Closed</option>
          </select>
        </label>
        <button className="btn btn-primary">Filter</button>
      </form>
      {data.items.length === 0 ? (
        <Empty>No jobs yet. Add a job source (it fills this list) or add a posting by hand.</Empty>
      ) : (
        <Table head={['Job', 'Where', 'Pay', 'Posted', 'Status']}>
          {data.items.map((j) => (
            <tr key={j.id} className="hover:bg-surface">
              <td className="td">
                <Link className="font-medium hover:underline" href={`/jobs/${j.id}`}>
                  {j.title}
                </Link>
                <div className="text-xs text-muted">{j.companyName}</div>
              </td>
              <td className="td">
                {label(j.remoteType)}
                {j.location ? <div className="text-xs text-muted">{j.location}</div> : null}
              </td>
              <td className="td text-muted">{salaryRange(j.salaryMin, j.salaryMax)}</td>
              <td className="td text-muted">{timeAgo(j.postedAt)}</td>
              <td className="td">
                <Badge tone={statusTone(j.status)}>{label(j.status)}</Badge>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        page={data.page}
        path="/jobs"
        params={{ q: sp.q, remoteType: sp.remoteType, status: sp.status, skill: sp.skill }}
      />
    </>
  );
}
