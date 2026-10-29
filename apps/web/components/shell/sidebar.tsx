'use client';

import {
  Bell,
  Briefcase,
  CreditCard,
  LayoutDashboard,
  Lock,
  LogOut,
  Radar,
  Rss,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Any one of these permissions shows the link; none listed means everyone. */
  needs?: string[];
}
interface Group {
  title: string;
  items: Item[];
}

const GROUPS: Group[] = [
  {
    title: 'Workspace',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/matches', label: 'Matches', icon: Sparkles, needs: ['jobs:read'] },
      { href: '/jobs', label: 'Jobs', icon: Briefcase, needs: ['jobs:read'] },
      { href: '/applications', label: 'Applications', icon: Send, needs: ['applications:read'] },
    ],
  },
  {
    title: 'Your search',
    items: [
      { href: '/profile', label: 'My profile', icon: UserRound, needs: ['candidates:read'] },
      { href: '/sources', label: 'Job sources', icon: Rss, needs: ['sources:manage'] },
    ],
  },
  {
    title: 'Organization',
    items: [
      { href: '/team', label: 'Team', icon: Users, needs: ['members:read'] },
      { href: '/audit', label: 'Audit trail', icon: ShieldCheck, needs: ['audit:read'] },
      { href: '/billing', label: 'Plan and usage', icon: CreditCard, needs: ['analytics:read'] },
      { href: '/settings', label: 'Settings', icon: Settings, needs: ['analytics:read'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { href: '/notifications', label: 'Notifications', icon: Bell },
      { href: '/security', label: 'Security', icon: Lock },
    ],
  },
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

export function Sidebar({
  permissions,
  unread,
  organization,
  fullName,
  role,
  logout,
  open,
  onClose,
}: {
  permissions: string[];
  unread: number;
  organization: string;
  fullName: string;
  role: string;
  logout: () => Promise<void>;
  open: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();
  const groups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.needs || i.needs.some((p) => permissions.includes(p))),
  })).filter((g) => g.items.length > 0);
  const all = groups.flatMap((g) => g.items);
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const best = all
    .filter((i) => active(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      {open ? (
        <button
          aria-label="Close the menu"
          className="no-print fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      ) : null}
      <aside
        className={`sidebar no-print fixed inset-y-0 left-0 z-50 flex flex-col transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Sidebar"
      >
        <div className="flex h-[var(--topbar-height)] shrink-0 items-center justify-between px-5">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={onClose}>
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #4338ca)',
                boxShadow: 'var(--shadow-brand)',
              }}
              aria-hidden="true"
            >
              <Radar className="h-5 w-5" />
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[15px] font-bold tracking-tight text-[var(--sidebar-text-active)]">
                JobPilot
              </span>
              <span className="block truncate text-[11px] text-[var(--sidebar-text)]">
                {organization}
              </span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close the menu"
            className="rounded-md p-1.5 text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] lg:hidden"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((g) => (
            <div key={g.title}>
              <p className="nav-section">{g.title}</p>
              <ul className="space-y-0.5">
                {g.items.map((i) => (
                  <li key={i.href}>
                    <Link
                      href={i.href}
                      aria-current={best === i.href ? 'page' : undefined}
                      className="nav-link"
                      onClick={onClose}
                    >
                      <i.icon aria-hidden="true" />
                      <span className="flex-1">{i.label}</span>
                      {i.href === '/notifications' && unread > 0 ? (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[11px] font-bold leading-none text-white"
                          style={{ background: 'var(--brand-600)' }}
                          aria-label={`${unread} unread`}
                        >
                          {unread}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-[var(--sidebar-border)] p-3">
          <div className="flex items-center gap-3 rounded-lg px-2 py-2">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #818cf8, #4f46e5)' }}
              aria-hidden="true"
            >
              {initials(fullName)}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13px] font-semibold text-[var(--sidebar-text-active)]">
                {fullName}
              </p>
              <p className="truncate text-[11px] text-[var(--sidebar-text)]">
                {role.toLowerCase()}
              </p>
            </div>
          </div>
          <form action={logout}>
            <button className="nav-link mt-1 w-full">
              <LogOut aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
