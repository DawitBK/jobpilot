import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/ui';
import { ssoConfig } from '@/lib/sso';
import { login } from './actions';
import { AuthForm } from './auth-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; notice?: string }>;
}) {
  const { next, error, notice } = await searchParams;
  // One quick try is enough here: "unavailable" still shows the button, and the click itself retries patiently.
  const sso = await ssoConfig({ attempts: 1 });
  const ssoOffered = sso.status !== 'disabled';
  const ssoHref = `/login/sso${next ? `?next=${encodeURIComponent(next)}` : ''}`;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back to JobPilot.</p>
      {notice === 'password-reset' || notice === 'password-changed' ? (
        <div className="mb-3">
          <Notice tone="good">
            {notice === 'password-reset'
              ? 'Your password was changed. Sign in with the new one.'
              : 'Your password was changed and every device was signed out. Sign in with the new one.'}
          </Notice>
        </div>
      ) : null}
      <AuthForm mode="login" action={login} next={next} />
      <p className="mt-3 text-center text-sm">
        <Link className="text-brand hover:underline" href="/forgot-password">
          Forgot your password?
        </Link>
      </p>
      {ssoOffered ? (
        <a className="btn mt-3 w-full text-center" href={ssoHref}>
          Sign in with SSO
        </a>
      ) : null}
      {error === 'sso-unavailable' ? (
        <div className="mt-3">
          <Notice>
            <p>Single sign-on is not answering right now. Please try again in a moment.</p>
            <a className="mt-1 inline-block text-brand hover:underline" href={ssoHref}>
              Try again
            </a>
          </Notice>
        </div>
      ) : error ? (
        <div className="mt-3 text-sm text-red-600" role="alert">
          <p>
            {error === 'no-account'
              ? 'The person signed in to single sign-on has no account here. Ask an administrator to add you, or sign in as someone else.'
              : error === 'no-access'
                ? 'You have not been given access to JobPilot. Ask an administrator to give you a role for it in the identity provider, or sign in as someone else.'
                : 'Single sign-on did not complete. Try again.'}
          </p>
          {(error === 'no-account' || error === 'no-access') && ssoOffered ? (
            <a className="btn mt-2 w-full text-center" href="/login/sso/switch">
              Sign out of single sign-on and use another account
            </a>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
