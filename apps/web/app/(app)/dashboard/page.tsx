import { Bell, CheckCircle2, FileText, Layers, Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Empty, PageHeader, Stat, Table, statusTone } from '@/components/ui';
import { label, timeAgo } from '@/lib/format';
import { apiOrNull, requireMe } from '@/lib/server-api';
import type { Application, Match, NotificationItem, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard', robots: { index: false } };

/** The states that need a person next, in the order they usually come up. */
const ACTIVE = [
  'SHORTLISTED',
  'RESUME_GENERATED',
  'COVER_LETTER_GENERATED',
  'READY_TO_APPLY',
  'NEEDS_HUMAN_REVIEW',
];
const OUT = ['APPLIED', 'SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER'];

/** The pipeline as a handful of stages a person thinks in, each with the colour it keeps everywhere. */
const FUNNEL: { name: string; states: string[]; color: string }[] = [
  { name: 'Matched', states: ['DISCOVERED', 'MATCHED'], color: '#94a3b8' },
  {
    name: 'Preparing',
    states: ['SHORTLISTED', 'RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'NEEDS_HUMAN_REVIEW'],
    color: '#818cf8',
  },
  { name: 'Ready', states: ['READY_TO_APPLY', 'APPROVED'], color: '#6366f1' },
  { name: 'Sent', states: ['APPLIED', 'SCREENING'], color: '#38bdf8' },
  { name: 'Interviewing', states: ['INTERVIEW', 'FINAL_INTERVIEW'], color: '#f59e0b' },
  { name: 'Offer', states: ['OFFER', 'ACCEPTED'], color: '#10b981' },
  { name: 'Closed', states: ['REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'EXPIRED'], color: '#f87171' },
];

const scoreTone = (n: number) =>
  n >= 80
    ? 'text-[var(--success-text)] bg-[var(--success-bg)] border-[var(--success-border)]'
    : n >= 60
      ? 'text-[var(--warning-text)] bg-[var(--warning-bg)] border-[var(--warning-border)]'
      : 'text-muted bg-raised border-line';

export default async function Dashboard() {
  const me = await requireMe();
  const canJobs = me.permissions.includes('jobs:read');
  const canApps = me.permissions.includes('applications:read');
  const [apps, matches, recent] = await Promise.all([
    canApps ? apiOrNull<Page<Application>>('/applications?limit=100') : Promise.resolve(null),
    canJobs && me.permissions.includes('candidates:read')
      ? apiOrNull<Page<Match>>('/matches?recommendation=APPLY&limit=5')
      : Promise.resolve(null),
    apiOrNull<Page<NotificationItem>>('/notifications?limit=5'),
  ]);
  const items = apps?.items ?? [];
  const count = (states: string[]) => items.filter((a) => states.includes(a.state)).length;
  const needsYou = items.filter(
    (a) => a.state === 'READY_TO_APPLY' || a.state === 'NEEDS_HUMAN_REVIEW',
  );
  const funnel = FUNNEL.map((f) => ({ ...f, n: count(f.states) }));
  const total = funnel.reduce((s, f) => s + f.n, 0);
  const waiting = count(['READY_TO_APPLY']);

  return (
    <>
      <PageHeader
        title={`Welcome, ${me.user.fullName.split(' ')[0]}`}
        subtitle={me.organization.name}
      />

      {apps ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Being prepared"
            value={count(ACTIVE)}
            icon={FileText}
            color="info"
            href="/applications"
            hint="Shortlisted, drafting or in review"
          />
          <Stat
            label="Waiting for your approval"
            value={waiting}
            icon={ShieldCheck}
            color={waiting > 0 ? 'warn' : 'good'}
            tone={waiting > 0 ? 'good' : undefined}
            href="/applications?state=READY_TO_APPLY"
            hint={
              waiting > 0
                ? 'Nothing is sent until you approve'
                : 'Nothing is waiting for a decision'
            }
          />
          <Stat
            label="Sent and in progress"
            value={count(OUT)}
            icon={Send}
            color="brand"
            href="/applications"
            hint="Applied through offer"
          />
          <Stat
            label="All applications"
            value={apps.page.total}
            icon={Layers}
            color="good"
            href="/applications"
          />
        </div>
      ) : null}

      {apps && total > 0 ? (
        <section className="card fade-up mt-6 p-5" aria-label="Pipeline">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Your pipeline</h2>
            <span className="text-xs text-subtle">{total} applications</span>
          </div>
          <div
            className="flex h-3 w-full overflow-hidden rounded-full bg-raised"
            role="img"
            aria-label={funnel.map((f) => `${f.name} ${f.n}`).join(', ')}
          >
            {funnel
              .filter((f) => f.n > 0)
              .map((f) => (
                <div
                  key={f.name}
                  style={{ width: `${(f.n / total) * 100}%`, background: f.color }}
                  title={`${f.name}: ${f.n}`}
                />
              ))}
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4 xl:grid-cols-7">
            {funnel.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: f.color }}
                  aria-hidden="true"
                />
                <span className="text-muted">{f.name}</span>
                <span className="ml-auto font-semibold tabular-nums text-ink">{f.n}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {apps ? (
          <section className="min-w-0">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Needs you</h2>
            {needsYou.length === 0 ? (
              <Empty icon={CheckCircle2} title="You are all caught up">
                Nothing is waiting for a decision.
              </Empty>
            ) : (
              <Table head={['Job', 'Stage', 'Since']}>
                {needsYou.map((a) => (
                  <tr key={a.id}>
                    <td className="td">
                      <Link
                        className="font-medium text-ink hover:text-brand"
                        href={`/applications/${a.id}`}
                      >
                        {a.jobTitle}
                      </Link>
                      <div className="text-xs text-muted">{a.companyName}</div>
                    </td>
                    <td className="td">
                      <Badge tone={statusTone(a.state)}>{label(a.state)}</Badge>
                    </td>
                    <td className="td text-muted">{timeAgo(a.stateEnteredAt)}</td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        ) : null}
        {matches ? (
          <section className="min-w-0">
            <h2 className="mb-3 text-[15px] font-semibold text-ink">Best matches</h2>
            {matches.items.length === 0 ? (
              <Empty icon={Sparkles} title="No strong matches yet">
                Add job sources and complete your profile, then check back.
              </Empty>
            ) : (
              <ul className="card fade-up divide-y divide-[var(--border-subtle)]">
                {matches.items.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/jobs/${m.jobId}`}
                      className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-raised"
                    >
                      <span
                        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-sm font-bold tabular-nums ${scoreTone(m.overallScore)}`}
                      >
                        {Math.round(m.overallScore)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">
                          {m.jobTitle}
                        </span>
                        <span className="block truncate text-xs text-muted">{m.companyName}</span>
                      </span>
                      <Badge tone={statusTone(m.recommendation)}>{label(m.recommendation)}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>

      {recent && recent.items.length > 0 ? (
        <section className="mt-6" aria-label="Recent activity">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Recent activity</h2>
            <Link href="/notifications" className="text-sm font-medium text-brand hover:underline">
              View all
            </Link>
          </div>
          <ul className="card fade-up divide-y divide-[var(--border-subtle)]">
            {recent.items.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${n.read ? 'bg-raised text-subtle' : 'bg-[var(--brand-100)] text-[var(--brand-700)] dark:bg-[rgba(99,102,241,0.16)] dark:text-[var(--brand-300)]'}`}
                  aria-hidden="true"
                >
                  <Bell className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-sm ${n.read ? 'text-muted' : 'font-medium text-ink'}`}
                  >
                    {n.title}
                  </p>
                  <p className="text-xs text-subtle">{timeAgo(n.createdAt)}</p>
                </div>
                {n.link ? (
                  <Link
                    href={n.link}
                    className="shrink-0 text-sm font-medium text-brand hover:underline"
                  >
                    Open
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!apps && !matches ? (
        <Empty title="Nothing here for your role">
          Your role has no personal workspace here. Use the menu to see what you can do.
        </Empty>
      ) : null}
    </>
  );
}
