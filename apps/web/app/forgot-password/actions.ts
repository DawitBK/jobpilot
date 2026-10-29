'use server';

import { headers } from 'next/headers';
import { forwardedFor } from '@/lib/client-ip';
import { API_URL } from '@/lib/session';

export interface ForgotState {
  error?: string;
  /** The same message whether or not the address has an account. */
  done?: boolean;
}

export async function requestReset(_prev: ForgotState, form: FormData): Promise<ForgotState> {
  const email = String(form.get('email') ?? '').trim();
  if (!email) return { error: 'Enter the email address of your account.' };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/forgot-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedFor(await headers()) },
      body: JSON.stringify({ email }),
      cache: 'no-store',
    });
  } catch {
    return { error: 'The server cannot be reached. Try again in a moment.' };
  }
  if (res.status === 400) return { error: 'That does not look like an email address.' };
  if (res.status === 429) return { error: 'Too many attempts. Wait a minute and try again.' };
  if (!res.ok) return { error: 'Something went wrong. Try again.' };
  return { done: true };
}
