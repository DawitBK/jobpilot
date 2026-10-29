import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';
import { Nav } from '@/components/nav';
import { apiOrNull, requireMe } from '@/lib/server-api';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  const unread = (await apiOrNull<{ count: number }>('/notifications/unread-count'))?.count ?? 0;
  return (
    <div className="min-h-screen md:grid md:grid-cols-[14rem_1fr]">
      <aside className="no-print border-b border-line bg-white p-3 md:min-h-screen md:border-r md:border-b-0">
        <div className="mb-4 px-2">
          <div className="text-base font-semibold tracking-tight text-brand">JobPilot</div>
          <div className="text-xs text-muted">{me.organization.name}</div>
          <div className="text-xs text-muted">
            {me.user.fullName} · {me.role.toLowerCase()}
          </div>
        </div>
        <Nav permissions={me.permissions} unread={unread} />
        <form action={logout} className="mt-4 px-2">
          <button className="btn w-full">Sign out</button>
        </form>
      </aside>
      <main className="min-w-0 p-4 md:p-6">{children}</main>
    </div>
  );
}
