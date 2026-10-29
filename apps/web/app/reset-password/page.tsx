import type { Metadata } from 'next';
import Link from 'next/link';
import { Notice } from '@/components/ui';
import { ResetForm } from './reset-form';

export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false } };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mb-5 text-sm text-muted">
        You will be signed out everywhere and asked to sign in with the new password.
      </p>
      {token ? (
        <ResetForm token={token} />
      ) : (
        <div className="space-y-3">
          <Notice tone="bad">This link is incomplete. Open the link from the email again.</Notice>
          <Link className="btn w-full text-center" href="/forgot-password">
            Ask for a new link
          </Link>
        </div>
      )}
    </main>
  );
}
