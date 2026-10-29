import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { conflict, ProblemException } from '@jobpilot/kit';
import argon2 from 'argon2';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { enqueue, recordAudit } from '../common/audit.js';
import { unauthorized } from '../common/errors.js';
import type { Principal } from '../common/auth.js';
import { mfaRecoveryCodes, users, type UserRow } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { SECRET_BOX, type SecretBox } from '../secrets/secret-box.js';
import { newSecret, otpauthUrl, stepOf, verifyCode } from './totp.js';

const ISSUER = 'JobPilot';
const RECOVERY_CODES = 10;
const hashCode = (code: string) =>
  createHash('sha256').update(code.replace(/[\s-]/g, '').toLowerCase()).digest('hex');
const secretContext = (userId: string) => `totp:${userId}`;

/** Ten codes like `k3f9-x2mq-7vba`, each usable once. Shown to the person a single time. */
function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const raw = randomBytes(6).toString('hex').slice(0, 12);
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  });
}

export interface SecondFactor {
  code?: string;
  recoveryCode?: string;
}

@Injectable()
export class MfaService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  private async user(userId: string): Promise<UserRow> {
    const [row] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    if (!row) throw unauthorized();
    return row;
  }

  async status(userId: string) {
    const user = await this.user(userId);
    const left = await this.tenant.global((tx) =>
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(mfaRecoveryCodes)
        .where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt))),
    );
    return {
      available: this.box.configured,
      enabled: user.totpEnabledAt !== null,
      recoveryCodesLeft: user.totpEnabledAt ? (left[0]?.n ?? 0) : 0,
    };
  }

  /** Start enrolment: a new secret that does nothing until the person proves they hold it (`enable`). */
  async setup(p: Principal): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.user(p.userId);
    if (user.totpEnabledAt) throw conflict('mfa-already-on', 'Two-step sign-in is already on');
    const secret = newSecret();
    const encrypted = this.box.encrypt(secret, secretContext(user.id));
    await this.tenant.global((tx) =>
      tx
        .update(users)
        .set({ totpSecretEnc: encrypted, totpLastStep: null })
        .where(eq(users.id, user.id)),
    );
    return { secret, otpauthUrl: otpauthUrl(secret, user.email, ISSUER) };
  }

  async enable(p: Principal, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.user(p.userId);
    if (user.totpEnabledAt) throw conflict('mfa-already-on', 'Two-step sign-in is already on');
    if (!user.totpSecretEnc) throw conflict('mfa-not-started', 'Start the setup first');
    const secret = this.box.decrypt(user.totpSecretEnc, secretContext(user.id));
    const step = verifyCode(secret, code, Date.now(), null);
    if (step === null)
      throw new ProblemException(
        422,
        'mfa-code-wrong',
        'That code is not right',
        'Check the code in your authenticator app and that your clock is correct.',
      );
    const codes = newRecoveryCodes();
    await this.tenant.inTenant(p, async (tx) => {
      await tx
        .update(users)
        .set({ totpEnabledAt: sql`now()`, totpLastStep: step })
        .where(eq(users.id, user.id));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
      await tx
        .insert(mfaRecoveryCodes)
        .values(codes.map((c) => ({ userId: user.id, codeHash: hashCode(c) })));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'mfa.enabled',
        resourceType: 'user',
        resourceId: user.id,
      });
      await enqueue(tx, p.organizationId, 'security.mfa', { userId: user.id, enabled: true });
    });
    return { recoveryCodes: codes };
  }

  /** Turning it off needs the password AND a current code (or a recovery code), so a stolen session alone cannot do it. */
  async disable(p: Principal, password: string, factor: SecondFactor): Promise<void> {
    const user = await this.user(p.userId);
    if (!user.totpEnabledAt) throw conflict('mfa-not-on', 'Two-step sign-in is not on');
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      throw new ProblemException(
        422,
        'password-wrong',
        'The password is not right',
        'Enter your current password.',
      );
    }
    if (!(await this.checkSecondFactor(user, factor))) {
      throw new ProblemException(
        422,
        'mfa-code-wrong',
        'That code is not right',
        'Use a current code or an unused recovery code.',
      );
    }
    await this.tenant.inTenant(p, async (tx) => {
      await tx
        .update(users)
        .set({ totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null })
        .where(eq(users.id, user.id));
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'mfa.disabled',
        resourceType: 'user',
        resourceId: user.id,
      });
      await enqueue(tx, p.organizationId, 'security.mfa', { userId: user.id, enabled: false });
    });
  }

  /** Replace the recovery codes (the old ones stop working). Needs a current authenticator code. */
  async regenerateRecoveryCodes(p: Principal, code: string): Promise<{ recoveryCodes: string[] }> {
    const user = await this.user(p.userId);
    if (!user.totpEnabledAt) throw conflict('mfa-not-on', 'Two-step sign-in is not on');
    if (!(await this.checkSecondFactor(user, { code }))) {
      throw new ProblemException(
        422,
        'mfa-code-wrong',
        'That code is not right',
        'Use a current code from your authenticator app.',
      );
    }
    const codes = newRecoveryCodes();
    await this.tenant.global(async (tx) => {
      await tx.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, user.id));
      await tx
        .insert(mfaRecoveryCodes)
        .values(codes.map((c) => ({ userId: user.id, codeHash: hashCode(c) })));
    });
    return { recoveryCodes: codes };
  }

  isEnabled(user: Pick<UserRow, 'totpEnabledAt'>): boolean {
    return user.totpEnabledAt !== null;
  }

  /** True when the code (or recovery code) is valid right now. A code works once; a recovery code is spent. */
  async checkSecondFactor(user: UserRow, factor: SecondFactor): Promise<boolean> {
    if (factor.recoveryCode) {
      const spent = await this.tenant.global((tx) =>
        tx
          .update(mfaRecoveryCodes)
          .set({ usedAt: sql`now()` })
          .where(
            and(
              eq(mfaRecoveryCodes.userId, user.id),
              eq(mfaRecoveryCodes.codeHash, hashCode(factor.recoveryCode!)),
              isNull(mfaRecoveryCodes.usedAt),
            ),
          )
          .returning({ id: mfaRecoveryCodes.id }),
      );
      return spent.length === 1;
    }
    if (!factor.code || !user.totpSecretEnc) return false;
    const secret = this.box.decrypt(user.totpSecretEnc, secretContext(user.id));
    const step = verifyCode(secret, factor.code, Date.now(), user.totpLastStep);
    if (step === null) return false;
    // Claim the step atomically: two requests with the same code cannot both succeed.
    const claimed = await this.tenant.global((tx) =>
      tx
        .update(users)
        .set({ totpLastStep: step })
        .where(
          and(
            eq(users.id, user.id),
            sql`(${users.totpLastStep} is null or ${users.totpLastStep} < ${step})`,
          ),
        )
        .returning({ id: users.id }),
    );
    return claimed.length === 1 && step <= stepOf(Date.now()) + 1;
  }
}
