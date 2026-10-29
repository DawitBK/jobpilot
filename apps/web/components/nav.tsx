'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Item {
  href: string;
  label: string;
  /** Any one of these permissions shows the link; none listed means everyone. */
  needs?: string[];
}

const ITEMS: Item[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/matches', label: 'Matches', needs: ['jobs:read'] },
  { href: '/jobs', label: 'Jobs', needs: ['jobs:read'] },
  { href: '/applications', label: 'Applications', needs: ['applications:read'] },
  { href: '/notifications', label: 'Notifications' },
  { href: '/profile', label: 'My profile', needs: ['candidates:read'] },
  { href: '/sources', label: 'Job sources', needs: ['sources:manage'] },
  { href: '/team', label: 'Team', needs: ['members:read'] },
  { href: '/audit', label: 'Audit trail', needs: ['audit:read'] },
  { href: '/billing', label: 'Plan and usage', needs: ['analytics:read'] },
  { href: '/settings', label: 'Settings', needs: ['analytics:read'] },
  { href: '/security', label: 'Security' },
];

export function Nav({ permissions, unread = 0 }: { permissions: string[]; unread?: number }) {
  const pathname = usePathname();
  const items = ITEMS.filter((i) => !i.needs || i.needs.some((p) => permissions.includes(p)));
  const active = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const best = items
    .filter((i) => active(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav aria-label="Main">
      <ul className="space-y-0.5">
        {items.map((i) => (
          <li key={i.href}>
            <Link
              href={i.href}
              aria-current={best === i.href ? 'page' : undefined}
              className={`block rounded-md px-2 py-1.5 text-sm ${
                best === i.href ? 'bg-brand/10 font-medium text-brand' : 'hover:bg-surface'
              }`}
            >
              {i.label}
              {i.href === '/notifications' && unread > 0 ? (
                <span
                  className="ml-2 rounded-full bg-brand px-1.5 py-0.5 text-xs text-white"
                  aria-label={`${unread} unread`}
                >
                  {unread}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
