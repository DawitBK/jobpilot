import type { Metadata } from 'next';
import { EntityButton } from '@/components/entity-form';
import type { FieldDef } from '@/components/entity-form';
import { ActionButton } from '@/components/form';
import { Badge, Empty, PageHeader, Stat } from '@/components/ui';
import { label, salaryRange } from '@/lib/format';
import { api, requireMe } from '@/lib/server-api';
import type { Profile } from '@/lib/types';

export const metadata: Metadata = { title: 'My profile', robots: { index: false } };

const opt = (values: string[]) => values.map((v) => ({ value: v, label: label(v) }));

const PROFILE: FieldDef[] = [
  { key: 'fullName', label: 'Full name', required: true, maxLength: 200 },
  {
    key: 'headline',
    label: 'Headline',
    maxLength: 200,
    hint: 'For example: Backend engineer, 6 years',
  },
  { key: 'targetRoles', label: 'Roles you want', list: true, hint: 'Separate with commas' },
  {
    key: 'targetLocations',
    label: 'Where you would work',
    list: true,
    hint: 'Cities or countries, separated with commas',
  },
  { key: 'salaryMin', label: 'Pay you need (a year)', kind: 'number', min: 0 },
  { key: 'salaryMax', label: 'Pay you hope for (a year)', kind: 'number', min: 0 },
  {
    key: 'workAuthStatus',
    label: 'Right to work',
    kind: 'select',
    options: opt(['CITIZEN', 'PERMANENT_RESIDENT', 'VISA_HOLDER', 'NEEDS_SPONSORSHIP', 'OTHER']),
  },
  {
    key: 'remotePref',
    label: 'Where you want to work',
    kind: 'select',
    options: opt(['REMOTE_ONLY', 'HYBRID', 'ONSITE', 'FLEXIBLE']),
  },
  {
    key: 'relocationOk',
    label: 'Would you relocate?',
    kind: 'select',
    boolean: true,
    options: [
      { value: 'false', label: 'No' },
      { value: 'true', label: 'Yes' },
    ],
  },
  { key: 'summary', label: 'About you', kind: 'textarea', maxLength: 5000 },
];

const SKILL: FieldDef[] = [
  { key: 'skillName', label: 'Skill', required: true, maxLength: 60 },
  {
    key: 'category',
    label: 'Area',
    kind: 'select',
    options: opt(['FRONTEND', 'BACKEND', 'DATABASE', 'DEVOPS', 'SOFT', 'OTHER']),
    initial: 'OTHER',
  },
  {
    key: 'proficiency',
    label: 'Level',
    kind: 'select',
    options: opt(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
    initial: 'INTERMEDIATE',
  },
  { key: 'yearsExperience', label: 'Years of experience', kind: 'number', min: 0 },
];
const EXPERIENCE: FieldDef[] = [
  { key: 'companyName', label: 'Company', required: true, maxLength: 200 },
  { key: 'title', label: 'Job title', required: true, maxLength: 200 },
  { key: 'startDate', label: 'Started', kind: 'date', required: true },
  { key: 'endDate', label: 'Ended', kind: 'date', hint: 'Leave empty if you still work there' },
  { key: 'technologies', label: 'Technologies used', list: true, hint: 'Separate with commas' },
  { key: 'description', label: 'What you did', kind: 'textarea', maxLength: 5000 },
];
const EDUCATION: FieldDef[] = [
  { key: 'institution', label: 'School', required: true, maxLength: 200 },
  { key: 'degree', label: 'Degree', required: true, maxLength: 200 },
  { key: 'field', label: 'Field of study', maxLength: 200 },
  { key: 'startDate', label: 'Started', kind: 'date' },
  { key: 'endDate', label: 'Finished', kind: 'date' },
];
const PROJECT: FieldDef[] = [
  { key: 'name', label: 'Project', required: true, maxLength: 200 },
  { key: 'url', label: 'Link', kind: 'text', maxLength: 2000, hint: 'https://…' },
  { key: 'technologies', label: 'Technologies used', list: true, hint: 'Separate with commas' },
  { key: 'description', label: 'What it is', kind: 'textarea', maxLength: 5000 },
];

export default async function ProfilePage() {
  const me = await requireMe();
  const p = await api<Profile>('/candidates/me');
  const canWrite = me.permissions.includes('candidates:write');
  const base = `/candidates/${p.id}`;
  const rec = (v: unknown) => v as Record<string, unknown> & { version: number };

  return (
    <>
      <PageHeader
        title={p.fullName}
        subtitle={p.headline ?? 'Add a headline so matches know what you are after.'}
        actions={
          canWrite ? (
            <EntityButton
              label="Edit profile"
              title="Edit your profile"
              fields={PROFILE}
              record={rec({ ...p, relocationOk: String(p.relocationOk) })}
              createPath={base}
              updatePath={base}
            />
          ) : null
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Experience" value={`${p.yearsExperience} years`} />
        <Stat label="Wants" value={p.targetRoles.length ? p.targetRoles.join(', ') : 'Not set'} />
        <Stat label="Pay" value={salaryRange(p.salaryMin, p.salaryMax)} />
        <Stat
          label="Work style"
          value={label(p.remotePref)}
          hint={`${label(p.workAuthStatus)}${p.relocationOk ? ' · will relocate' : ''}`}
        />
      </div>
      {p.summary ? <p className="mb-6 max-w-prose text-sm text-muted">{p.summary}</p> : null}

      <Section
        title="Skills"
        add={
          canWrite ? (
            <EntityButton
              label="Add a skill"
              title="Add a skill"
              fields={SKILL}
              createPath={`${base}/skills`}
            />
          ) : null
        }
        empty={
          p.skills.length === 0 ? 'Matching works from your skills. Add the ones you use.' : null
        }
      >
        <ul className="flex flex-wrap gap-2">
          {p.skills.map((s) => (
            <li key={s.id} className="card flex items-center gap-2 px-3 py-1.5 text-sm">
              <span className="font-medium">{s.skillName}</span>
              <Badge>{label(s.proficiency)}</Badge>
              {s.yearsExperience !== null ? (
                <span className="text-xs text-muted">{s.yearsExperience}y</span>
              ) : null}
              {canWrite ? (
                <ActionButton
                  label="Remove"
                  method="DELETE"
                  path={`${base}/skills/${s.id}`}
                  danger
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Experience"
        add={
          canWrite ? (
            <EntityButton
              label="Add a job"
              title="Add experience"
              fields={EXPERIENCE}
              createPath={`${base}/experience`}
            />
          ) : null
        }
        empty={p.experience.length === 0 ? 'No work history yet.' : null}
      >
        <ul className="space-y-2">
          {p.experience.map((x) => (
            <li key={x.id} className="card flex items-start justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-medium">
                  {x.title} · {x.companyName}
                </div>
                <div className="text-xs text-muted">
                  {x.startDate} to {x.endDate ?? 'now'}
                  {x.technologies.length ? ` · ${x.technologies.join(', ')}` : ''}
                </div>
                {x.description ? <p className="mt-1 text-muted">{x.description}</p> : null}
              </div>
              {canWrite ? (
                <ActionButton
                  label="Remove"
                  method="DELETE"
                  path={`${base}/experience/${x.id}`}
                  danger
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Education"
        add={
          canWrite ? (
            <EntityButton
              label="Add education"
              title="Add education"
              fields={EDUCATION}
              createPath={`${base}/education`}
            />
          ) : null
        }
        empty={p.education.length === 0 ? 'No education added.' : null}
      >
        <ul className="space-y-2">
          {p.education.map((x) => (
            <li key={x.id} className="card flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <span className="font-medium">{x.degree}</span>
                {x.field ? `, ${x.field}` : ''} · {x.institution}
              </div>
              {canWrite ? (
                <ActionButton
                  label="Remove"
                  method="DELETE"
                  path={`${base}/education/${x.id}`}
                  danger
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Projects"
        add={
          canWrite ? (
            <EntityButton
              label="Add a project"
              title="Add a project"
              fields={PROJECT}
              createPath={`${base}/projects`}
            />
          ) : null
        }
        empty={p.projects.length === 0 ? 'No projects added.' : null}
      >
        <ul className="space-y-2">
          {p.projects.map((x) => (
            <li key={x.id} className="card flex items-start justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-medium">{x.name}</div>
                {x.technologies.length ? (
                  <div className="text-xs text-muted">{x.technologies.join(', ')}</div>
                ) : null}
                {x.description ? <p className="mt-1 text-muted">{x.description}</p> : null}
                {x.url ? (
                  <a
                    className="text-xs text-brand hover:underline"
                    href={x.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {x.url}
                  </a>
                ) : null}
              </div>
              {canWrite ? (
                <ActionButton
                  label="Remove"
                  method="DELETE"
                  path={`${base}/projects/${x.id}`}
                  danger
                />
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function Section({
  title,
  add,
  empty,
  children,
}: {
  title: string;
  add: React.ReactNode;
  empty: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {add}
      </div>
      {empty ? <Empty>{empty}</Empty> : children}
    </section>
  );
}
