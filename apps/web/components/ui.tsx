import { AlertCircle, CheckCircle2, Info, Inbox, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Page } from '@/lib/types';

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'badge-neutral',
  good: 'badge-good',
  warn: 'badge-warn',
  bad: 'badge-bad',
  info: 'badge-info',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${TONES[tone]}`}>{children}</span>;
}

export function statusTone(status: string): Tone {
  switch (status) {
    case 'APPLY':
    case 'ACTIVE':
    case 'OK':
    case 'APPLIED':
    case 'OFFER':
    case 'ACCEPTED':
    case 'APPROVED':
    case 'READY_TO_APPLY':
      return 'good';
    case 'SKIP':
    case 'ERROR':
    case 'REJECTED':
    case 'WITHDRAWN':
    case 'NO_RESPONSE':
    case 'EXPIRED':
    case 'CLOSED':
    case 'REMOVED':
      return 'bad';
    case 'MAYBE':
    case 'NEEDS_HUMAN_REVIEW':
      return 'warn';
    case 'SCREENING':
    case 'INTERVIEW':
    case 'FINAL_INTERVIEW':
    case 'SHORTLISTED':
    case 'MATCHED':
    case 'RESUME_GENERATED':
    case 'COVER_LETTER_GENERATED':
      return 'info';
    default:
      return 'neutral';
  }
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="no-print fade-up mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <span className="h-8 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <h1 className="truncate text-2xl font-bold tracking-tight text-ink">{title}</h1>
        </div>
        {subtitle ? <p className="mt-1 ml-4 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TILE: Record<'brand' | 'good' | 'warn' | 'bad' | 'info', string> = {
  brand:
    'bg-[var(--brand-100)] text-[var(--brand-700)] dark:bg-[rgba(99,102,241,0.16)] dark:text-[var(--brand-300)]',
  good: 'bg-[var(--success-bg)] text-[var(--success-text)]',
  warn: 'bg-[var(--warning-bg)] text-[var(--warning-text)]',
  bad: 'bg-[var(--danger-bg)] text-[var(--danger-text)]',
  info: 'bg-[var(--info-bg)] text-[var(--info-text)]',
};

/** A figure with its label and an icon tile, the same card DMS uses for its dashboards. */
export function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
  color = 'brand',
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'good' | 'bad';
  icon?: LucideIcon;
  color?: keyof typeof TILE;
  href?: string;
}) {
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm text-muted">{label}</p>
        <p
          className={`mt-1 font-bold tabular-nums ${typeof value === 'string' && value.length > 12 ? 'text-lg leading-snug' : 'text-3xl'} ${tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink'}`}
        >
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
      </div>
      {Icon ? (
        <div className={`shrink-0 rounded-lg p-3 ${TILE[color]}`} aria-hidden="true">
          <Icon className="h-6 w-6" />
        </div>
      ) : null}
    </div>
  );
  return href ? (
    <Link href={href} className="card card-hover fade-up block p-5">
      {body}
    </Link>
  ) : (
    <div className="card fade-up p-5">{body}</div>
  );
}

/** Nothing here yet: an icon tile, what it means, and, when there is one, the next step. */
export function Empty({
  children,
  icon: Icon = Inbox,
  title,
  action,
}: {
  children: ReactNode;
  icon?: LucideIcon;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 flex h-[52px] w-[52px] items-center justify-center rounded-xl border border-line bg-raised">
        <Icon className="h-6 w-6 text-subtle" aria-hidden="true" />
      </div>
      {title ? <p className="text-[15px] font-semibold text-ink">{title}</p> : null}
      <p className={`max-w-md text-sm text-muted ${title ? 'mt-1' : ''}`}>{children}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'bad' | 'good';
  children: ReactNode;
}) {
  const style = {
    info: {
      cls: 'border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info-text)]',
      icon: Info,
    },
    bad: {
      cls: 'border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]',
      icon: AlertCircle,
    },
    good: {
      cls: 'border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]',
      icon: CheckCircle2,
    },
  }[tone];
  const Icon = style.icon;
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${style.cls}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="card fade-up overflow-x-auto">
      <table className="w-full min-w-max border-collapse">
        <thead className="border-b border-line">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className={`th ${h.startsWith('>') ? 'text-right' : ''}`}>
                {h.replace(/^>/, '')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border-subtle)] [&>tr]:transition-colors [&>tr:hover]:bg-raised">
          {children}
        </tbody>
      </table>
    </div>
  );
}

/** Previous / next links that keep every other query parameter. */
export function Pager({
  page,
  path,
  params,
}: {
  page: Page<unknown>['page'];
  path: string;
  params: Record<string, string | undefined>;
}) {
  const { limit, offset, total } = page;
  if (total <= limit) return null;
  const href = (o: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (o > 0) sp.set('offset', String(o));
    const s = sp.toString();
    return s ? `${path}?${s}` : path;
  };
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <nav
      aria-label="Pages"
      className="no-print mt-4 flex items-center justify-between text-sm text-muted"
    >
      <span>
        {from}–{to} of {total}
      </span>
      <span className="flex gap-2">
        {offset > 0 ? (
          <Link className="btn btn-sm" href={href(Math.max(offset - limit, 0))}>
            Previous
          </Link>
        ) : null}
        {offset + limit < total ? (
          <Link className="btn btn-sm" href={href(offset + limit)}>
            Next
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

export function num(value: string | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
