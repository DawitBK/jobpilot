import type { Metadata } from 'next';
import { Plus, Rss } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionButton } from '@/components/form';
import { Badge, Empty, PageHeader, Table, statusTone } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import { api, requireMe } from '@/lib/server-api';
import type { CatalogEntry, Source } from '@/lib/types';
import { filterSummary, hasFilters } from './filter-model';
import { EditSource, ImportLinks, RunHistory, RunSource } from './source-forms';

export const metadata: Metadata = { title: 'Job sources', robots: { index: false } };

export default async function SourcesPage() {
  const me = await requireMe();
  if (!me.permissions.includes('sources:manage')) redirect('/dashboard');
  const [sources, catalog] = await Promise.all([
    api<Source[]>('/sources'),
    api<CatalogEntry[]>('/sources/catalog'),
  ]);
  const kind = (s: Source) => catalog.find((c) => c.id === s.presetId)?.name ?? label(s.type);
  const add = (
    <Link className="btn btn-primary" href="/sources/catalog">
      <Plus aria-hidden="true" className="h-4 w-4" /> Add a source
    </Link>
  );
  return (
    <>
      <PageHeader
        title="Job sources"
        subtitle="Where JobPilot looks for jobs. Each source is read on its own schedule, keeps only what you asked for, and never reads a page its site asks robots not to."
        actions={
          <>
            <ImportLinks />
            {add}
          </>
        }
      />
      {sources.length === 0 ? (
        <Empty icon={Rss} title="No sources yet" action={add}>
          Choose from remote boards, African and Ethiopian job sites, company careers pages and more
          — or set up any site yourself.
        </Empty>
      ) : (
        <Table head={['Source', 'Last read', 'Next read', '']}>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className="td">
                <div className="font-medium">{s.name}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                  <Badge>{kind(s)}</Badge>
                  {!s.enabled ? <Badge tone="warn">Paused</Badge> : null}
                </div>
                {hasFilters(s.filters) ? (
                  <div className="mt-1 max-w-80 text-xs text-muted">{filterSummary(s.filters)}</div>
                ) : null}
              </td>
              <td className="td">
                {s.lastRunAt ? (
                  <>
                    <Badge tone={statusTone(s.lastRunStatus ?? '')}>
                      {s.lastRunStatus === 'OK' ? 'Worked' : 'Failed'}
                    </Badge>
                    <div
                      className={`mt-0.5 max-w-72 text-xs ${s.lastRunStatus === 'ERROR' ? 'text-bad' : 'text-muted'}`}
                    >
                      {formatDateTime(s.lastRunAt)}
                      {s.lastRunMessage ? ` · ${s.lastRunMessage}` : ''}
                    </div>
                  </>
                ) : (
                  <span className="text-muted">Not yet</span>
                )}
              </td>
              <td className="td text-sm text-muted">
                {!s.enabled ? (
                  'Paused'
                ) : s.nextRunAt ? (
                  <>
                    {formatDateTime(s.nextRunAt)}
                    <div className="text-xs">
                      {s.consecutiveFailures > 0
                        ? `Waiting longer after ${s.consecutiveFailures} failed ${s.consecutiveFailures === 1 ? 'read' : 'reads'}`
                        : `Every ${s.pollIntervalMinutes} min`}
                    </div>
                  </>
                ) : (
                  `Soon · every ${s.pollIntervalMinutes} min`
                )}
              </td>
              <td className="td">
                <div className="ml-auto flex max-w-80 flex-wrap justify-end gap-2">
                  <RunSource id={s.id} />
                  <RunHistory id={s.id} name={s.name} />
                  <EditSource source={s} />
                  <ActionButton
                    label={s.enabled ? 'Pause' : 'Resume'}
                    method="PATCH"
                    path={`/sources/${s.id}`}
                    body={{ version: s.version, enabled: !s.enabled }}
                  />
                  <ActionButton
                    label="Remove"
                    method="DELETE"
                    path={`/sources/${s.id}`}
                    danger
                    confirm={`Remove ${s.name}? Jobs already collected stay.`}
                  />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
