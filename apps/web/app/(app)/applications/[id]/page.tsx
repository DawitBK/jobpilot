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

const ACTOR: Record<string, string> = {
  USER: 'You or a teammate',
  SYSTEM: 'JobPilot',
  AI_AGENT: 'AI assistant',
  BROWSER_WORKER: 'Browser worker',
};

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
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {documents ? (
            <Documents
              applicationId={app.id}
              state={app.state}
              data={documents}
              canWrite={canWrite}
            />
          ) : null}
          {emails ? <Emails applicationId={app.id} emails={emails} canWrite={canWrite} /> : null}
          <section aria-label="Timeline">
            <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
            <ol className="space-y-3 border-l border-line pl-4">
              {[...app.events].reverse().map((e, i) => {
                const note =
                  typeof e.payload['note'] === 'string' ? (e.payload['note'] as string) : null;
                return (
                  <li key={`${e.createdAt}-${i}`} className="relative">
                    <span
                      className="absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full bg-brand"
                      aria-hidden="true"
                    />
                    <div className="text-sm">
                      <span className="font-medium">
                        {e.fromState ? `${label(e.fromState)} → ` : ''}
                        {label(e.toState)}
                      </span>
                      <span className="ml-2 text-xs text-muted">
                        {ACTOR[e.actorType] ?? e.actorType} · {formatDateTime(e.createdAt)}
                      </span>
                    </div>
                    {note ? <p className="mt-0.5 text-sm text-muted">“{note}”</p> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="space-y-4">
          {app.match ? (
            <section className="card p-4 text-sm">
              <h2 className="mb-2 font-semibold">Match</h2>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-semibold tabular-nums">
                  {Math.round(app.match.overallScore)}
                </span>
                <Badge tone={statusTone(app.match.recommendation)}>
                  {label(app.match.recommendation)}
                </Badge>
              </div>
              {app.match.missingSkills.length > 0 ? (
                <p className="mt-2 text-muted">Missing: {app.match.missingSkills.join(', ')}</p>
              ) : null}
              <Link
                className="mt-2 inline-block text-brand hover:underline"
                href={`/jobs/${app.jobId}`}
              >
                View the job
              </Link>
            </section>
          ) : null}

          {review ? (
            <section className="card p-4 text-sm" aria-label="Review">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Review</h2>
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
                <p className="mt-2 text-muted">Nothing here needs a second look.</p>
              ) : (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                  {review.reasons.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-muted">{review.autoSubmitNote}</p>
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
