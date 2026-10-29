'use server';

import { cookies, headers } from 'next/headers';
import { forwardedFor } from '@/lib/client-ip';
import { redirect } from 'next/navigation';
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  accessCookie,
  refreshCookie,
  type TokenPair,
} from '@/lib/session';
import type { OrganizationChoice } from '@/lib/types';

export interface AuthState {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Several organizations: the person must pick one before tokens are issued. */
  choice?: OrganizationChoice;
  /** The account has two-step sign-in on: the person must give a code before tokens are issued. */
  mfa?: { mfaToken: string };
}

/** Only same-site paths: a "next" parameter must never send someone to another website. */
function safeNext(value: FormDataEntryValue | null): string {
  const v = typeof value === 'string' ? value : '';
  return v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/dashboard';
}

type Reply = { json?: unknown; state?: AuthState };

async function post(path: string, payload: unknown): Promise<Reply> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedFor(await headers()) },
      body: JSON.stringify(payload),
      cache: 'no-store',
    });
  } catch {
    return { state: { error: 'The server cannot be reached. Try again in a moment.' } };
  }
  if (res.status === 401) {
    return {
      state: {
        error:
          path === 'mfa'
            ? 'That code is not right, or it has expired. Try the next one.'
            : 'That email and password do not match.',
      },
    };
  }
  if (res.status === 429) {
    return { state: { error: 'Too many attempts. Wait a minute and try again.' } };
  }
  if (res.status === 409) return { state: { error: 'An account with that email already exists.' } };
  if (res.status === 400) {
    const problem = (await res.json().catch(() => ({}))) as {
      errors?: { path?: string; message?: string }[];
    };
    const fieldErrors: Record<string, string> = {};
    for (const e of problem.errors ?? []) if (e.path && e.message) fieldErrors[e.path] = e.message;
    return { state: { error: 'Please correct the highlighted fields.', fieldErrors } };
  }
  if (!res.ok) return { state: { error: 'Something went wrong. Try again.' } };
  return { json: await res.json() };
}

async function finish(tokens: TokenPair, next: string): Promise<never> {
  const jar = await cookies();
  jar.set(accessCookie(tokens));
  jar.set(refreshCookie(tokens));
  redirect(next);
}

/** Either tokens (one organization) or a choice to make (several). */
async function signIn(payload: unknown, path: string, next: string): Promise<AuthState> {
  const r = await post(path, payload);
  if (!r.json) return r.state ?? {};
  const body = r.json as TokenPair | OrganizationChoice | { mfaRequired: true; mfaToken: string };
  if ('mfaRequired' in body) return { mfa: { mfaToken: body.mfaToken } };
  if ('organizationSelectionRequired' in body) return { choice: body };
  return finish(body, next);
}

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };
  return signIn({ email, password }, 'login', safeNext(form.get('next')));
}

/** The second step: a six-digit code, or a recovery code. */
export async function completeMfa(_prev: AuthState, form: FormData): Promise<AuthState> {
  const mfaToken = String(form.get('mfaToken') ?? '');
  const entered = String(form.get('code') ?? '').trim();
  if (!mfaToken || !entered)
    return { mfa: { mfaToken }, error: 'Enter the code from your authenticator app.' };
  const payload = /^\d{6}$/.test(entered)
    ? { mfaToken, code: entered }
    : { mfaToken, recoveryCode: entered };
  const state = await signIn(payload, 'mfa', safeNext(form.get('next')));
  // A wrong code keeps the person on the code step (their sign-in has not expired).
  return state.error && !state.mfa ? { ...state, mfa: { mfaToken } } : state;
}

export async function chooseOrganization(_prev: AuthState, form: FormData): Promise<AuthState> {
  const selectionToken = String(form.get('selectionToken') ?? '');
  const organizationId = String(form.get('organizationId') ?? '');
  if (!selectionToken || !organizationId) return { error: 'Choose an organization.' };
  return signIn(
    { selectionToken, organizationId },
    'select-organization',
    safeNext(form.get('next')),
  );
}

export async function register(_prev: AuthState, form: FormData): Promise<AuthState> {
  const payload = {
    fullName: String(form.get('fullName') ?? '').trim(),
    email: String(form.get('email') ?? '').trim(),
    password: String(form.get('password') ?? ''),
  };
  if (payload.password.length < 12) {
    return {
      error: 'Please correct the highlighted fields.',
      fieldErrors: { password: 'Use at least 12 characters.' },
    };
  }
  const created = await post('register', payload);
  if (!created.json) return created.state ?? {};
  return signIn(
    { email: payload.email, password: payload.password },
    'login',
    safeNext(form.get('next')),
  );
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const refreshToken = jar.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${API_URL}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...forwardedFor(await headers()) },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    }).catch(() => undefined);
  }
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/');
}

/** After a password change every session has ended on the server: clear this browser's cookies too and ask for the new password. */
export async function endSessionsAfterPasswordChange(): Promise<void> {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
  redirect('/login?notice=password-changed');
}
