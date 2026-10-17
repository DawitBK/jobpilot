import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Badge, Empty, PageHeader, Pager, Table, num } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { api, qs, requireMe } from '@/lib/server-api';
import type { AuditEntry, Page } from '@/lib/types';
import { VerifyChain } from './verify';

export const metadata: Metadata = { title: 'Audit trail', robots: { index: false } };

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const sp = await searchParams;
  const me = await requireMe();
  if (!me.permissions.includes('audit:read')) redirect('/dashboard');
  const data = await api<Page<AuditEntry>>(`/audit${qs({ offset: num(sp.offset), limit: 50 })}`);
  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Every action, newest first. Each entry is chained to the one before it, so an edit or a removal is detectable."
        actions={<VerifyChain />}
      />
      {data.items.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <Table head={['#', 'When', 'Who', 'What', 'On']}>
          {data.items.map((a) => (
            <tr key={a.id}>
              <td className="td tabular-nums text-muted">{a.id}</td>
              <td className="td">{formatDateTime(a.createdAt)}</td>
              <td className="td">
                <Badge>{a.actorType.toLowerCase().replace('_', ' ')}</Badge>
              </td>
              <td className="td font-mono text-xs">{a.action}</td>
              <td className="td text-muted">
                {a.resourceType}
                {a.resourceId ? ` ${a.resourceId.slice(0, 8)}` : ''}
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager page={data.page} path="/audit" params={{}} />
    </>
  );
}
