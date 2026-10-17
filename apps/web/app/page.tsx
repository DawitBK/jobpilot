import Link from 'next/link';
import { currentMe } from '@/lib/server-api';

const POINTS = [
  [
    'Jobs from sources you choose',
    'Point JobPilot at an RSS feed or a company job board. New postings are cleaned up, de-duplicated and kept in one place.',
  ],
  [
    'A score you can argue with',
    'Every job gets a match score with its parts shown: skills, location, seniority and pay, what is missing and what is strong. A job you cannot take (no sponsorship, wrong place) is always skipped, however well the skills fit.',
  ],
  [
    'A pipeline, not a spreadsheet',
    'Each application moves through clear states from discovered to offer, with a timeline of who did what and when.',
  ],
  [
    'Nothing is sent without you',
    'Only a person can approve an application. The rule is enforced in the code and again in the database, and every action is written to a tamper-evident audit trail.',
  ],
] as const;

export default async function Landing() {
  const me = await currentMe();
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="mb-14 flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-brand">JobPilot</span>
        <nav className="flex gap-2">
          {me ? (
            <Link className="btn btn-primary" href="/dashboard">
              Open your workspace
            </Link>
          ) : (
            <>
              <Link className="btn" href="/login">
                Sign in
              </Link>
              <Link className="btn btn-primary" href="/register">
                Get started
              </Link>
            </>
          )}
        </nav>
      </header>
      <main>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight">
          A job search that never applies without you
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Collect jobs, see exactly why each one fits or does not, and keep every application moving
          through a pipeline you control.
        </p>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2">
          {POINTS.map(([title, text]) => (
            <li key={title} className="card p-5">
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
