import type { Metadata } from 'next';
import { register } from '../login/actions';
import { AuthForm } from '../login/auth-form';

export const metadata: Metadata = { title: 'Create an account', robots: { index: false } };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Create your workspace</h1>
      <p className="mb-5 text-sm text-muted">
        Your own private workspace: your profile, your jobs, your applications.
      </p>
      <AuthForm mode="register" action={register} next={next} />
    </main>
  );
}
