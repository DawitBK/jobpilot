import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MatchBreakdown } from '@/components/match-card';
import { Badge, PageHeader, statusTone } from '@/components/ui';
import { label, salaryRange, timeAgo } from '@/lib/format';
import { apiOrNull, requireMe } from '@/lib/server-api';
import type { Application, Job, Match, Page, Profile } from '@/lib/types';
import { StartApplication } from './start-application';

export const metadata: Metadata = { title: 'Job', robots: { index: false } };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireMe();
  const job = await apiOrNull<Job>(`/jobs/${id}`);
  if (!job) notFound();

  const canMatch = me.permissions.includes('candidates:read');
  const profile = canMatch ? await apiOrNull<Profile>('/candidates/me') : null;
  const [matches, existing] = await Promise.all([
    profile
      ? apiOrNull<Page<Match>>(`/matches?jobId=${id}&candidateProfileId=${profile.id}`)
      : null,
    profile && me.permissions.includes('applications:read')
      ? apiOrNull<Page<Application>>(`/applications?jobId=${id}&candidateProfileId=${profile.id}`)
      : null,
  ]);
  const match = matches?.items[0];
  const application = existing?.items[0];

  return (
    <>
      <PageHeader
        title={job.title}
        subtitle={`${job.companyName}${job.location ? ` · ${job.location}` : ''}`}
        actions={<Badge tone={statusTone(job.status)}>{label(job.status)}</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          <dl className="card grid grid-cols-2 gap-3 p-4 text-sm sm:grid-cols-4">
            <Fact k="Where" v={label(job.remoteType)} />
            <Fact k="Level" v={job.seniority ? label(job.seniority) : 'Not stated'} />
            <Fact k="Pay (a year)" v={salaryRange(job.salaryMin, job.salaryMax)} />
            <Fact
              k="Visa sponsorship"
              v={
                job.visaSponsorship === null
                  ? 'Not stated'
                  : job.visaSponsorship
                    ? 'Offered'
                    : 'Not offered'
              }
            />
            <Fact k="Type" v={label(job.employmentType)} />
            <Fact k="Posted" v={timeAgo(job.postedAt)} />
          </dl>
          {job.requiredSkills.length > 0 || job.preferredSkills.length > 0 ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Skills</h2>
              <div className="flex flex-wrap gap-1.5">
                {job.requiredSkills.map((s) => (
                  <Badge key={`r-${s}`} tone="info">
                    {s}
                  </Badge>
                ))}
                {job.preferredSkills.map((s) => (
                  <Badge key={`p-${s}`}>{s} (nice to have)</Badge>
                ))}
              </div>
            </section>
          ) : null}
          {job.description ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Description</h2>
              <div className="max-w-prose whitespace-pre-line text-sm leading-relaxed">
                {job.description}
              </div>
            </section>
          ) : null}
          {job.applicationUrl ? (
            <p className="text-sm">
              <a
                className="text-brand hover:underline"
                href={job.applicationUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Open the employer's posting
              </a>
            </p>
          ) : null}
        </div>

        <aside className="space-y-4">
          {match ? (
            <section className="card p-4" aria-label="Your match">
              <h2 className="mb-3 text-sm font-semibold">How well you match</h2>
              <MatchBreakdown match={match} />
            </section>
          ) : canMatch ? (
            <section className="card p-4 text-sm text-muted">
              No score yet. Complete your profile and rescore from the Matches page.
            </section>
          ) : null}
          {profile && me.permissions.includes('applications:write') ? (
            application ? (
              <Link className="btn w-full" href={`/applications/${application.id}`}>
                View your application ({label(application.state)})
              </Link>
            ) : (
              <StartApplication
                jobId={job.id}
                candidateProfileId={profile.id}
                blocked={Boolean(match && match.hardFilters.length > 0)}
              />
            )
          ) : null}
        </aside>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
