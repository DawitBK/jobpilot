import type { Metadata } from 'next';
import { ForgotForm } from './forgot-form';

export const metadata: Metadata = { title: 'Forgot your password', robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mb-5 text-sm text-muted">
        Enter the email address of your account and we will send you a link to choose a new one.
      </p>
      <ForgotForm />
    </main>
  );
}
