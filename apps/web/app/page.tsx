import {
  ArrowRight,
  FileCheck2,
  History,
  Radar,
  Rss,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';
import Link from 'next/link';
import { ThemeSwitcher } from '@/components/shell/theme-switcher';
import { currentMe } from '@/lib/server-api';

const POINTS = [
  [
    Rss,
    'Jobs from sources you choose',
    'Point JobPilot at an RSS feed or a company job board. New postings are cleaned up, de-duplicated and kept in one place.',
  ],
  [
    Sparkles,
    'A score you can argue with',
    'Every job gets a match score with its parts shown: skills, location, seniority and pay, what is missing and what is strong. A job you cannot take (no sponsorship, wrong place) is always skipped, however well the skills fit.',
  ],
  [
    Workflow,
    'A pipeline, not a spreadsheet',
    'Each application moves through clear states from discovered to offer, with a timeline of who did what and when.',
  ],
  [
    FileCheck2,
    'Documents that cannot invent',
    'Resumes and cover letters can be drafted with the AI provider you choose, then every sentence is checked against your own record. Anything the record does not support stops for you.',
  ],
  [
    ShieldCheck,
    'Nothing is sent without you',
    'Only a person can approve an application. The rule is enforced in the code and again in the database.',
  ],
  [
    History,
    'A trail you can verify',
    'Every action is written to a tamper-evident audit trail that proves, on demand, that nothing was edited or removed.',
  ],
] as const;

const STEPS = [
  ['1', 'Add your profile', 'Skills, experience and what you want.'],
  ['2', 'Collect jobs', 'Feeds and boards, or paste one in.'],
  ['3', 'Review the matches', 'See why each one fits, or does not.'],
  ['4', 'You approve, then it moves', 'Every step is yours and on the record.'],
] as const;

export default async function Landing() {
  const me = await currentMe();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-card/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl text-white"
              style={{
                background: 'linear-gradient(135deg, #6366f1, #4338ca)',
                boxShadow: 'var(--shadow-brand)',
              }}
              aria-hidden="true"
            >
              <Radar className="h-5 w-5" />
            </span>
            <span className="text-lg font-bold tracking-tight text-ink">JobPilot</span>
          </Link>
          <nav className="flex items-center gap-2">
            <ThemeSwitcher />
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
        </div>
      </header>

      <main>
        <section
          className="relative overflow-hidden text-white"
          style={{
            background:
              'radial-gradient(110% 90% at 15% 0%, #312e81 0%, #0b0b1a 55%, #050505 100%)',
          }}
        >
          <div
            className="pointer-events-none absolute top-1/2 -right-32 h-[28rem] w-[28rem] -translate-y-1/2 rounded-full opacity-30 blur-3xl"
            style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
            aria-hidden="true"
          />
          <div className="relative mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-indigo-200">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> Human approval, enforced in
              the database
            </p>
            <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl sm:leading-[1.05]">
              A job search that never applies without you
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-300">
              Collect jobs, see exactly why each one fits or does not, and keep every application
              moving through a pipeline you control.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              {me ? (
                <Link className="btn btn-primary min-h-11 px-5 text-[15px]" href="/dashboard">
                  Open your workspace <ArrowRight />
                </Link>
              ) : (
                <>
                  <Link className="btn btn-primary min-h-11 px-5 text-[15px]" href="/register">
                    Create your workspace <ArrowRight />
                  </Link>
                  <Link
                    className="btn min-h-11 border-white/20 bg-white/5 px-5 text-[15px] text-white hover:bg-white/10"
                    href="/login"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-label="What it does">
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {POINTS.map(([Icon, title, text]) => (
              <li key={title} className="card card-hover p-6">
                <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--brand-100)] text-[var(--brand-700)] dark:bg-[rgba(99,102,241,0.16)] dark:text-[var(--brand-300)]">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">{text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="border-t border-line bg-card" aria-label="How it works">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-bold tracking-tight text-ink">How it works</h2>
            <ol className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map(([n, title, text]) => (
                <li key={n} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-bold text-white">
                    {n}
                  </span>
                  <div>
                    <p className="font-semibold text-ink">{title}</p>
                    <p className="mt-1 text-sm text-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <footer className="border-t border-line py-8 text-center text-xs text-subtle">
        JobPilot · every workspace is isolated from every other, in the database itself
      </footer>
    </div>
  );
}
