import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHeader, Pager, num } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { api, qs } from '@/lib/server-api';
import type { NotificationItem, Page } from '@/lib/types';
import { MarkAllRead, MarkRead } from './mark';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };

const KIND_LABEL: Record<string, string> = {
  WELCOME: 'Welcome',
  NEW_MATCH: 'New match',
  APPROVAL_NEEDED: 'Needs approval',
  APPLICATION_UPDATE: 'Update',
  NEEDS_REVIEW: 'Needs review',
  JOBS_FOUND: 'Jobs found',
  SECURITY: 'Security',
};
const KIND_TONE: Record<string, 'good' | 'warn' | 'info' | 'neutral'> = {
  APPROVAL_NEEDED: 'warn',
  NEEDS_REVIEW: 'warn',
  NEW_MATCH: 'info',
  JOBS_FOUND: 'info',
  APPLICATION_UPDATE: 'good',
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; show?: string }>;
}) {
  const sp = await searchParams;
  const unreadOnly = sp.show === 'unread';
  const data = await api<Page<NotificationItem>>(
    `/notifications${qs({ offset: num(sp.offset), limit: 25, unread: unreadOnly ? 'true' : undefined })}`,
  );
  const hasUnread = data.items.some((n) => !n.read);
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="What needs you, and what moved. Nothing is sent to an employer without your approval."
        actions={
          <>
            <Link
              className="btn"
              href={unreadOnly ? '/notifications' : '/notifications?show=unread'}
            >
              {unreadOnly ? 'Show all' : 'Show unread only'}
            </Link>
            {hasUnread ? <MarkAllRead /> : null}
          </>
        }
      />
      {data.items.length === 0 ? (
        <Empty>{unreadOnly ? 'Nothing unread.' : 'No notifications yet.'}</Empty>
      ) : (
        <ul className="card divide-y divide-line">
          {data.items.map((n) => (
            <li
              key={n.id}
              className={`flex flex-wrap items-start gap-3 p-3 ${n.read ? '' : 'bg-brand/5'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[n.kind] ?? 'neutral'}>
                    {KIND_LABEL[n.kind] ?? n.kind}
                  </Badge>
                  <span className={`text-sm ${n.read ? '' : 'font-semibold'}`}>{n.title}</span>
                </div>
                {n.body ? <p className="mt-1 text-sm text-muted">{n.body}</p> : null}
                <p className="mt-1 text-xs text-muted">
                  {formatDateTime(n.createdAt)}
                  {n.emailStatus === 'SENT' ? ' · also emailed' : ''}
                  {n.emailStatus === 'FAILED' ? ' · the email could not be sent' : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {n.link ? (
                  <Link className="btn" href={n.link}>
                    Open
                  </Link>
                ) : null}
                {n.read ? null : <MarkRead id={n.id} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Pager
        page={data.page}
        path="/notifications"
        params={{ show: unreadOnly ? 'unread' : undefined }}
      />
    </>
  );
}
