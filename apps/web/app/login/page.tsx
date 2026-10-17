import type { Metadata } from 'next';
import { login } from './actions';
import { AuthForm } from './auth-form';

export const metadata: Metadata = { title: 'Sign in', robots: { index: false } };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mb-5 text-sm text-muted">Welcome back to JobPilot.</p>
      <AuthForm mode="login" action={login} next={next} />
    </main>
  );
}
