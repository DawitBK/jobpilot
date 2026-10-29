import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { FailureLimiter, LockedOutError, unprocessable } from '@jobpilot/kit';
import argon2 from 'argon2';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { MAILER, type Mailer } from '../outbox/mailer.js';
import type { Principal } from '../common/auth.js';
import { conflict, unauthorized } from '../common/errors.js';
import { passwordResets, refreshTokens, users } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { clearLoginFailures, hashPassword } from './auth.service.js';
import type { ChangePassword, ForgotPassword, ResetPassword } from './auth.contract.js';

export const ACCOUNT_OPTIONS = 'JOBPILOT_ACCOUNT_OPTIONS';
export interface AccountOptions {
  /** The public address of the web app: the recovery link points there. */
  appUrl: string;
}

/** How long a recovery link works. */
const RESET_TTL_MS = 60 * 60_000;

const INVALID_LINK = 'This link is not valid any more. Ask for a new one.';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/**
 * Three recovery links per address per hour. A person who asks a fourth time is told the same thing as everyone else
 * (the answer never reveals whether an address has an account), but no further mail is sent.
 */
const resetRequests = new FailureLimiter({
  maxFailures: 3,
  windowMs: 3_600_000,
  lockMs: 3_600_000,
});

/** Recovering and changing a password. Accounts managed by the identity provider have no local password to recover. */
@Injectable()
export class AccountService {
  private readonly log = new Logger('account');

  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ACCOUNT_OPTIONS) private readonly options: AccountOptions,
  ) {}

  /**
   * Mails a one-time link. Always answers the same way, whether or not the address has an account, whether or not mail could be sent:
   * the answer must not tell a stranger who is registered.
   */
  async requestReset(input: ForgotPassword): Promise<void> {
    try {
      resetRequests.assertAllowed(input.email);
    } catch (e) {
      if (e instanceof LockedOutError) return; // already mailed three times this hour
      throw e;
    }
    resetRequests.recordFailure(input.email); // counts every request, so the limit holds for unknown addresses too

    const [user] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.email, input.email)),
    );
    // A person who signs in through the identity provider is let in or out there; a local password would be a way around it.
    if (!user || user.status !== 'ACTIVE' || user.ssoSubject) return;

    const token = randomBytes(32).toString('base64url');
    await this.tenant.global(async (tx) => {
      // Only the newest link works.
      await tx
        .update(passwordResets)
        .set({ usedAt: sql`now()` })
        .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));
      await tx.insert(passwordResets).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + RESET_TTL_MS),
      });
    });

    const link = `${this.options.appUrl.replace(/\/+$/, '')}/reset-password?token=${token}`;
    await this.send(user.email, {
      subject: 'Reset your JobPilot password',
      text:
        `Hello ${user.fullName},\n\n` +
        `Someone asked to reset the password of this JobPilot account. If it was you, open this link within one hour:\n\n${link}\n\n` +
        'The link works once. If it was not you, ignore this message: your password has not changed.',
    });
  }

  /** The link from the mail plus a new password: the password is set, every session ends, and the link is spent. */
  async reset(input: ResetPassword): Promise<void> {
    const hash = sha256(input.token);
    const usable = and(
      eq(passwordResets.tokenHash, hash),
      isNull(passwordResets.usedAt),
      gt(passwordResets.expiresAt, sql`now()`),
    );
    // A token that was never issued is refused before any password hashing is done: guessing must not cost the server a hash each time.
    const [candidate] = await this.tenant.global((tx) =>
      tx.select({ id: passwordResets.id }).from(passwordResets).where(usable),
    );
    if (!candidate) throw unprocessable('reset-link-invalid', INVALID_LINK);
    const passwordHash = await hashPassword(input.password);
    const person = await this.tenant.global(async (tx) => {
      // Spent in the same statement that checks it, so two people holding the same link cannot both use it.
      const [found] = await tx
        .update(passwordResets)
        .set({ usedAt: sql`now()` })
        .where(usable)
        .returning({ userId: passwordResets.userId });
      if (!found) return null;
      const [user] = await tx
        .update(users)
        .set({ passwordHash })
        .where(and(eq(users.id, found.userId), eq(users.status, 'ACTIVE')))
        .returning({ email: users.email, fullName: users.fullName });
      if (!user) return null;
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.userId, found.userId), isNull(refreshTokens.revokedAt)));
      return user;
    });
    if (!person) throw unprocessable('reset-link-invalid', INVALID_LINK);
    clearLoginFailures(person.email);
    await this.notifyChanged(person.email, person.fullName);
  }

  /** The signed-in person changes their own password: the current one is required, and every session ends, this one included. */
  async change(p: Principal, input: ChangePassword): Promise<void> {
    const [user] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.id, p.userId)),
    );
    if (!user || user.status !== 'ACTIVE') throw unauthorized('The account is not active');
    if (user.ssoSubject) {
      throw conflict(
        'sso-managed',
        'This account signs in through the identity provider: its password is changed there.',
      );
    }
    const ok = await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false);
    if (!ok) throw unauthorized('The current password is not right');
    const passwordHash = await hashPassword(input.newPassword);
    await this.tenant.global(async (tx) => {
      await tx.update(users).set({ passwordHash }).where(eq(users.id, user.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt)));
    });
    await this.notifyChanged(user.email, user.fullName);
  }

  private notifyChanged(to: string, fullName: string): Promise<void> {
    return this.send(to, {
      subject: 'Your JobPilot password was changed',
      text:
        `Hello ${fullName},\n\nThe password of your JobPilot account was just changed and every device was signed out. ` +
        'If you did not do this, ask for a password reset straight away.',
    });
  }

  /** A notice that cannot be delivered (no mail server, or it is down) never fails the change itself. */
  private async send(to: string, message: { subject: string; text: string }): Promise<void> {
    try {
      await this.mailer.send({ to, ...message });
    } catch (e) {
      this.log.warn(`mail to a user was not sent: ${(e as Error).message}`);
    }
  }
}
