import { FileCheck2, History, Radar, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeSwitcher } from '@/components/shell/theme-switcher';

const POINTS: [typeof Sparkles, string][] = [
  [Sparkles, 'A match score you can argue with, parts shown'],
  [FileCheck2, 'Documents checked sentence by sentence against your record'],
  [ShieldCheck, 'Only a person can approve an application'],
  [History, 'A tamper-evident trail of every action'],
];

/** The frame around sign-in, sign-up and password recovery: the same split screen the identity provider uses. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside
        className="relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex"
        style={{ background: 'radial-gradient(120% 80% at 0% 0%, #1e1b4b 0%, #050505 60%)' }}
      >
        <div
          className="pointer-events-none absolute -right-24 -bottom-24 h-96 w-96 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
          aria-hidden="true"
        />
        <Link href="/" className="relative flex items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #6366f1, #4338ca)',
              boxShadow: 'var(--shadow-brand)',
            }}
            aria-hidden="true"
          >
            <Radar className="h-5 w-5" />
          </span>
          <span className="text-lg font-bold tracking-tight">JobPilot</span>
        </Link>
        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-bold tracking-tight">
            A job search that never applies without you.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-slate-300">
            Collect jobs from the sources you trust, see exactly why each one fits or does not, and
            move every application through a pipeline you control.
          </p>
          <ul className="mt-8 space-y-3.5">
            {POINTS.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3 text-sm text-slate-200">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8 text-indigo-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-slate-500">
          JobPilot · Secured with row-level isolation per workspace
        </p>
      </aside>

      <div className="flex min-h-screen flex-col bg-surface">
        <div className="flex items-center justify-between px-6 pt-5">
          <Link href="/" className="flex items-center gap-2 lg:invisible">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
              style={{ background: 'linear-gradient(135deg, #6366f1, #4338ca)' }}
              aria-hidden="true"
            >
              <Radar className="h-4 w-4" />
            </span>
            <span className="font-bold tracking-tight text-ink">JobPilot</span>
          </Link>
          <ThemeSwitcher />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-10">
          <div className="fade-up w-full max-w-sm [&_main]:min-h-0 [&_main]:max-w-none [&_main]:px-0 [&_main]:py-0 [&_h1]:text-[26px] [&_h1]:font-bold [&_h1]:tracking-tight">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
