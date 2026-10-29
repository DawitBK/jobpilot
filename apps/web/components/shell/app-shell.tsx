'use client';

import { Bell, ChevronDown, Lock, LogOut, Menu, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar, initials } from './sidebar';
import { ThemeSwitcher } from './theme-switcher';

const TITLES: [string, string][] = [
  ['/dashboard', 'Dashboard'],
  ['/matches', 'Matches'],
  ['/jobs', 'Jobs'],
  ['/applications', 'Applications'],
  ['/profile', 'My profile'],
  ['/sources', 'Job sources'],
  ['/team', 'Team'],
  ['/audit', 'Audit trail'],
  ['/billing', 'Plan and usage'],
  ['/settings', 'Settings'],
  ['/notifications', 'Notifications'],
  ['/security', 'Security'],
];

export interface ShellProps {
  fullName: string;
  email: string;
  role: string;
  organization: string;
  permissions: string[];
  unread: number;
  logout: () => Promise<void>;
  children: ReactNode;
}

/** The frame around every signed-in page: sidebar, top bar, and the content area. */
export function AppShell({ children, ...me }: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const title =
    TITLES.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? 'JobPilot';
  const canSearch = me.permissions.includes('jobs:read');

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [pathname]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [menu]);

  return (
    <div className="min-h-screen">
      <Sidebar
        permissions={me.permissions}
        unread={me.unread}
        organization={me.organization}
        fullName={me.fullName}
        role={me.role}
        logout={me.logout}
        open={open}
        onClose={() => setOpen(false)}
      />
      <div className="lg:pl-[var(--sidebar-width)]">
        <header className="topbar no-print sticky top-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="btn btn-ghost h-9 w-9 min-h-0 p-0 lg:hidden"
              aria-label="Open the menu"
              onClick={() => setOpen(true)}
            >
              <Menu />
            </button>
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
          </div>

          <div className="flex items-center gap-1.5">
            {canSearch ? (
              <form
                action="/jobs"
                method="get"
                role="search"
                className="relative mr-1 hidden md:block"
              >
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-subtle"
                  aria-hidden="true"
                />
                <input
                  name="q"
                  type="search"
                  aria-label="Search jobs"
                  placeholder="Search jobs, companies, skills"
                  className="input w-72 pl-9"
                />
              </form>
            ) : null}
            <Link
              href="/notifications"
              className="btn btn-ghost relative h-9 w-9 min-h-0 p-0"
              aria-label={me.unread > 0 ? `Notifications, ${me.unread} unread` : 'Notifications'}
            >
              <Bell />
              {me.unread > 0 ? (
                <span
                  className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                  style={{ background: 'var(--brand-600)' }}
                  aria-hidden="true"
                >
                  {me.unread > 9 ? '9+' : me.unread}
                </span>
              ) : null}
            </Link>
            <ThemeSwitcher />
            <span className="mx-1 hidden h-5 w-px bg-[var(--border)] sm:block" aria-hidden="true" />
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 transition-colors hover:bg-raised"
                aria-haspopup="menu"
                aria-expanded={menu}
                onClick={() => setMenu(!menu)}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
                  style={{ background: 'linear-gradient(135deg, #818cf8, #4f46e5)' }}
                  aria-hidden="true"
                >
                  {initials(me.fullName)}
                </span>
                <span className="hidden text-left leading-tight sm:block">
                  <span className="block max-w-32 truncate text-[13px] font-semibold text-ink">
                    {me.fullName}
                  </span>
                  <span className="block text-[11px] text-subtle">{me.role.toLowerCase()}</span>
                </span>
                <ChevronDown className="hidden h-4 w-4 text-subtle sm:block" aria-hidden="true" />
              </button>
              {menu ? (
                <div
                  role="menu"
                  className="card absolute right-0 z-50 mt-2 w-64 overflow-hidden p-1.5"
                  style={{ boxShadow: 'var(--shadow-lg)' }}
                >
                  <div className="border-b border-line px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-ink">{me.fullName}</p>
                    <p className="truncate text-xs text-muted">{me.email}</p>
                  </div>
                  <Link
                    role="menuitem"
                    href="/security"
                    className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink hover:bg-raised"
                  >
                    <Lock className="h-4 w-4 text-subtle" /> Security
                  </Link>
                  {me.permissions.includes('analytics:read') ? (
                    <Link
                      role="menuitem"
                      href="/settings"
                      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-ink hover:bg-raised"
                    >
                      <Settings className="h-4 w-4 text-subtle" /> Settings
                    </Link>
                  ) : null}
                  <form action={me.logout}>
                    <button
                      role="menuitem"
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-bad hover:bg-raised"
                    >
                      <LogOut className="h-4 w-4" /> Sign out
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
