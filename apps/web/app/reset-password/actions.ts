'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { forwardedFor } from '@/lib/client-ip';
import { API_URL } from '@/lib/session';

export interface ResetState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

export async function resetPassword(_prev: ResetState, form: FormData): Promise<ResetState> {
  const token = String(form.get('token') ?? '');
  const password = String(form.get('password') ?? '');
  const again = String(form.get('again') ?? '');
  if (password.length < 12) {
    return { fieldErrors: { password: 'Use at least 12 characters.' } };
  }
  if (password !== again) return { fieldErrors: { again: 'The two passwords are not the same.' } };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedFor(await headers()) },
      body: JSON.stringify({ token, password }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'The server cannot be reached. Try again in a moment.' };
  }
  if (res.status === 422) {
    return { error: 'This link is not valid any more. Ask for a new one.' };
  }
  if (res.status === 429) return { error: 'Too many attempts. Wait a minute and try again.' };
  if (res.status === 400) return { fieldErrors: { password: 'Use 12 to 128 characters.' } };
  if (!res.ok) return { error: 'Something went wrong. Try again.' };
  redirect('/login?notice=password-reset');
}
