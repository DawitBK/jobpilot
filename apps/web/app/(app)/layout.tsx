import type { ReactNode } from 'react';
import { logout } from '@/app/login/actions';
import { AppShell } from '@/components/shell/app-shell';
import { apiOrNull, requireMe } from '@/lib/server-api';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const me = await requireMe();
  const unread = (await apiOrNull<{ count: number }>('/notifications/unread-count'))?.count ?? 0;
  return (
    <AppShell
      fullName={me.user.fullName}
      email={me.user.email}
      role={me.role}
      organization={me.organization.name}
      permissions={me.permissions}
      unread={unread}
      logout={logout}
    >
      {children}
    </AppShell>
  );
}
