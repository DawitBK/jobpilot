import type { Metadata } from 'next';
import { ActionButton } from '@/components/form';
import { Badge, Empty, PageHeader, Table, statusTone } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import { api, requireMe } from '@/lib/server-api';
import { redirect } from 'next/navigation';
import type { Source } from '@/lib/types';
import { NewSource, RunSource } from './source-forms';

export const metadata: Metadata = { title: 'Job sources', robots: { index: false } };

export default async function SourcesPage() {
  const me = await requireMe();
  if (!me.permissions.includes('sources:manage')) redirect('/dashboard');
  const sources = await api<Source[]>('/sources');
  return (
    <>
      <PageHeader
        title="Job sources"
        subtitle="Feeds JobPilot reads for new postings. Addresses on private networks are refused."
        actions={<NewSource />}
      />
      {sources.length === 0 ? (
        <Empty>No sources yet. Add an RSS feed or a Greenhouse company board.</Empty>
      ) : (
        <Table head={['Source', 'Type', 'Last run', 'Every', '']}>
          {sources.map((s) => (
            <tr key={s.id}>
              <td className="td">
                <div className="font-medium">{s.name}</div>
                <div className="max-w-80 truncate text-xs text-muted">
                  {Object.entries(s.config)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </div>
              </td>
              <td className="td">
                <Badge>{label(s.type)}</Badge>
                {!s.enabled ? <Badge tone="warn">Paused</Badge> : null}
              </td>
              <td className="td">
                {s.lastRunAt ? (
                  <>
                    <Badge tone={statusTone(s.lastRunStatus ?? '')}>
                      {s.lastRunStatus === 'OK' ? 'Worked' : 'Failed'}
                    </Badge>
                    <div className="mt-0.5 text-xs text-muted">
                      {formatDateTime(s.lastRunAt)}
                      {s.lastRunMessage ? ` · ${s.lastRunMessage}` : ''}
                    </div>
                  </>
                ) : (
                  <span className="text-muted">Never</span>
                )}
              </td>
              <td className="td text-muted">{s.pollIntervalMinutes} min</td>
              <td className="td">
                <div className="flex justify-end gap-2">
                  <RunSource id={s.id} />
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
