import { Bot, Check, Cog, Gauge, User, X } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Notice, PageHeader, statusTone } from '@/components/ui';
import { formatDateTime, label } from '@/lib/format';
import { apiOrNull, requireMe } from '@/lib/server-api';
import type { ApplicationDetail, DocumentsResponse, EmailItem, Review } from '@/lib/types';
import { ApprovalCard, Transitions } from './actions';
import { Documents } from './documents';
import { Emails } from './emails';

export const metadata: Metadata = { title: 'Application', robots: { index: false } };

const ACTOR: Record<string, { text: string; icon: typeof User }> = {
  USER: { text: 'You or a teammate', icon: User },
  SYSTEM: { text: 'JobPilot', icon: Cog },
  AI_AGENT: { text: 'AI assistant', icon: Bot },
  BROWSER_WORKER: { text: 'Browser worker', icon: Bot },
};

/** The route an application takes when all goes well: where each state sits along it. */
const STEPS: { name: string; states: string[] }[] = [
  { name: 'Matched', states: ['DISCOVERED', 'MATCHED'] },
  { name: 'Shortlisted', states: ['SHORTLISTED'] },
  { name: 'Documents', states: ['RESUME_GENERATED', 'COVER_LETTER_GENERATED'] },
  { name: 'Ready', states: ['READY_TO_APPLY'] },
  { name: 'Approved', states: ['APPROVED'] },
  { name: 'Sent', states: ['APPLIED'] },
  { name: 'Screening', states: ['SCREENING'] },
  { name: 'Interview', states: ['INTERVIEW', 'FINAL_INTERVIEW'] },
  { name: 'Offer', states: ['OFFER'] },
  { name: 'Accepted', states: ['ACCEPTED'] },
];
const CLOSED = ['REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'EXPIRED'];

const stepOf = (state: string) => STEPS.findIndex((s) => s.states.includes(state));

function Stepper({ app }: { app: ApplicationDetail }) {
  const closed = CLOSED.includes(app.state);
  // Closed or stopped for review: show how far it got, from the last state it was in on the route.
  let at = stepOf(app.state);
  if (at < 0) {
    for (const e of [...app.events].reverse()) {
      const found = stepOf(e.fromState ?? '');
      if (found >= 0) {
        at = found;
        break;
      }
    }
  }
  return (
    <section className="card fade-up mb-6 overflow-x-auto p-5" aria-label="Progress">
      <ol className="flex min-w-max items-start">
        {STEPS.map((s, i) => {
          const done = i < at || (i === at && app.state === 'ACCEPTED');
          const current = i === at && app.state !== 'ACCEPTED';
          const stopped = current && (closed || app.state === 'NEEDS_HUMAN_REVIEW');
          return (
            <li
              key={s.name}
              className="flex flex-1 flex-col items-center"
              aria-current={current ? 'step' : undefined}
            >
              <div className="flex w-full items-center">
                <span
                  className={`h-0.5 flex-1 ${i === 0 ? 'opacity-0' : i <= at ? 'bg-brand' : 'bg-[var(--border)]'}`}
                />
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    done
                      ? 'border-brand bg-brand text-white'
                      : stopped
                        ? closed
                          ? 'border-[var(--danger)] bg-[var(--danger-bg)] text-[var(--danger-text)]'
                          : 'border-[var(--warning)] bg-[var(--warning-bg)] text-[var(--warning-text)]'
                        : current
                          ? 'border-brand bg-card text-brand shadow-[var(--shadow-focus)]'
                          : 'border-[var(--border)] bg-card text-subtle'
                  }`}
                >
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : stopped && closed ? (
                    <X className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={`h-0.5 flex-1 ${i === STEPS.length - 1 ? 'opacity-0' : i < at ? 'bg-brand' : 'bg-[var(--border)]'}`}
                />
              </div>
              <span
                className={`mt-2 px-1 text-center text-xs ${current ? 'font-semibold text-ink' : done ? 'text-muted' : 'text-subtle'}`}
              >
                {s.name}
              </span>
            </li>
          );
        })}
      </ol>
      {closed ? (
        <p className="mt-3 text-sm text-[var(--danger-text)]">
          This application ended as {label(app.state).toLowerCase()}.
        </p>
      ) : app.state === 'NEEDS_HUMAN_REVIEW' ? (
        <p className="mt-3 text-sm text-[var(--warning-text)]">
          It was stopped for a person to look at before it goes on.
        </p>
      ) : null}
    </section>
  );
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMe();
  const app = await apiOrNull<ApplicationDetail>(`/applications/${id}`);
  if (!app) notFound();
  const canWrite = me.permissions.includes('applications:write');
  const canApprove = me.permissions.includes('applications:approve');
  const next = app.allowedNext.filter((s) => s !== 'APPROVED');
  const canApproveNow = app.state === 'READY_TO_APPLY' && app.allowedNext.includes('APPROVED');
  const [review, documents, emails] = await Promise.all([
    apiOrNull<Review>(`/applications/${id}/review`),
    apiOrNull<DocumentsResponse>(`/applications/${id}/documents`),
    apiOrNull<EmailItem[]>(`/applications/${id}/emails`),
  ]);

  return (
    <>
      <PageHeader
        title={app.jobTitle}
        subtitle={app.companyName}
        actions={<Badge tone={statusTone(app.state)}>{label(app.state)}</Badge>}
      />
      <Stepper app={app} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {documents ? (
            <Documents
              applicationId={app.id}
              state={app.state}
              data={documents}
              canWrite={canWrite}
            />
          ) : null}
          {emails ? <Emails applicationId={app.id} emails={emails} canWrite={canWrite} /> : null}
          <section aria-label="Timeline" className="card p-5">
            <h2 className="mb-4 text-[15px] font-semibold text-ink">Timeline</h2>
            <ol className="relative space-y-5 border-l border-line pl-6">
              {[...app.events].reverse().map((e, i) => {
                const note =
                  typeof e.payload['note'] === 'string' ? (e.payload['note'] as string) : null;
                const actor = ACTOR[e.actorType] ?? { text: e.actorType, icon: User };
                const Icon = actor.icon;
                return (
                  <li key={`${e.createdAt}-${i}`} className="relative">
                    <span
                      className="absolute top-0 -left-[2.15rem] flex h-6 w-6 items-center justify-center rounded-full border border-line bg-card text-brand"
                      aria-hidden="true"
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-sm font-semibold text-ink">
                        {e.fromState ? `${label(e.fromState)} → ` : ''}
                        {label(e.toState)}
                      </span>
                      <span className="text-xs text-muted">
                        {actor.text} · {formatDateTime(e.createdAt)}
                      </span>
                    </div>
                    {note ? <p className="mt-1 text-sm text-muted">“{note}”</p> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          {app.match ? (
            <section className="card p-5 text-sm">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-ink">
                <Gauge className="h-4 w-4 text-subtle" aria-hidden="true" /> Match
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-4xl font-bold tabular-nums text-ink">
                  {Math.round(app.match.overallScore)}
                </span>
                <Badge tone={statusTone(app.match.recommendation)}>
                  {label(app.match.recommendation)}
                </Badge>
              </div>
              {app.match.missingSkills.length > 0 ? (
                <p className="mt-3 text-muted">Missing: {app.match.missingSkills.join(', ')}</p>
              ) : null}
              <Link
                className="mt-3 inline-block font-medium text-brand hover:underline"
                href={`/jobs/${app.jobId}`}
              >
                View the job
              </Link>
            </section>
          ) : null}

          {review ? (
            <section className="card p-5 text-sm" aria-label="Review">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-ink">Review</h2>
                <Badge
                  tone={review.tier === 'HIGH' ? 'bad' : review.tier === 'MEDIUM' ? 'warn' : 'good'}
                >
                  {review.tier === 'LOW'
                    ? 'Low risk'
                    : review.tier === 'MEDIUM'
                      ? 'Look twice'
                      : 'High risk'}
                </Badge>
              </div>
              {review.reasons.length === 0 ? (
                <p className="mt-3 text-muted">Nothing here needs a second look.</p>
              ) : (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-muted">
                  {review.reasons.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-subtle">{review.autoSubmitNote}</p>
            </section>
          ) : null}

          {canApproveNow && canApprove ? (
            <ApprovalCard applicationId={app.id} review={review} />
          ) : canApproveNow ? (
            <Notice>
              This application is ready. A person with approval rights must approve it.
            </Notice>
          ) : null}

          {app.approvedAt ? (
            <p className="text-sm text-muted">Approved {formatDateTime(app.approvedAt)}.</p>
          ) : null}

          {canWrite && next.length > 0 ? (
            <Transitions applicationId={app.id} states={next} />
          ) : null}
          {next.length === 0 && !canApproveNow ? (
            <p className="text-sm text-muted">This application has reached its final state.</p>
          ) : null}
        </aside>
      </div>
    </>
  );
}
