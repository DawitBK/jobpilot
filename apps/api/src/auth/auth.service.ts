import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  conflict,
  FailureLimiter,
  LockedOutError,
  notFound,
  ProblemException,
  tooManyRequests,
  unprocessable,
} from '@jobpilot/kit';
import argon2 from 'argon2';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { assertWithinQuota } from '../billing/quota.js';
import { enqueue, recordAudit } from '../common/audit.js';
import { AUTH_CONFIG, type AuthConfig, type Principal, TokenService } from '../common/auth.js';
import { forbidden, pgCode, unauthorized } from '../common/errors.js';
import type { Permission } from '../common/permissions.js';
import type { Tx } from '../db/db.module.js';
import {
  candidateProfiles,
  organizationMembers,
  organizations,
  refreshTokens,
  roles,
  users,
  type RoleName,
  type UserRow,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { MfaService } from './mfa.service.js';
import type { MfaChallenge, MfaLogin } from './mfa.contract.js';
import { fullNameFrom, hasAccessFromIdp, type SsoAccess } from './sso-access.js';
import type {
  AddMember,
  Login,
  MemberDto,
  OrganizationChoice,
  Register,
  SelectOrganization,
  TokenPair,
  UpdateMember,
  UpdateOrganization,
} from './auth.contract.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

// argon2id with the OWASP-recommended minimum cost (19 MiB, 2 passes, 1 lane).
const ARGON2 = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
// A hash of a throwaway value, verified when the email is unknown so both failures cost the same.
const DUMMY_HASH = await argon2.hash(randomUUID(), ARGON2);

/**
 * Five failed sign-ins for one email in fifteen minutes lock that email for fifteen minutes, even
 * against the right password, so a guess spread over many addresses is still slow. Unknown emails
 * are counted the same way, so the lock does not reveal which accounts exist. The cost: someone
 * can lock a known email out for a while, which is the standard trade for slowing guessing.
 */
const loginFailures = new FailureLimiter({
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
});

function assertNotLocked(email: string): void {
  try {
    loginFailures.assertAllowed(email);
  } catch (e) {
    if (e instanceof LockedOutError) {
      throw tooManyRequests(
        e.retryAfterSeconds,
        'Too many failed sign-ins for this account. Try again later.',
      );
    }
    throw e;
  }
}

export const hashPassword = (password: string) => argon2.hash(password, ARGON2);

interface Membership {
  organizationId: string;
  organizationName: string;
  role: RoleName;
  permissions: Permission[];
}

const setOrg = (tx: Tx, organizationId: string) =>
  tx.execute(sql`select set_config('app.organization_id', ${organizationId}, true)`);

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${randomBytes(3).toString('hex')}`;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
    @Inject(MfaService) private readonly mfa: MfaService,
  ) {}

  /** Create an account and its personal workspace, where the person is both the owner and the candidate. */
  async register(input: Register): Promise<{ id: string; email: string; fullName: string }> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.tenant.global(async (tx) => {
        const [user] = await tx
          .insert(users)
          .values({ email: input.email, passwordHash, fullName: input.fullName })
          .returning();
        await this.createPersonalOrganization(tx, user!);
        return { id: user!.id, email: user!.email, fullName: user!.fullName };
      });
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('email-taken', 'Email already registered');
      throw e;
    }
  }

  async login(input: Login): Promise<TokenPair | OrganizationChoice | MfaChallenge> {
    assertNotLocked(input.email);
    const [user] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.email, input.email)),
    );
    const ok = await argon2
      .verify(user?.passwordHash ?? DUMMY_HASH, input.password)
      .catch(() => false);
    if (!user || !ok || user.status !== 'ACTIVE') {
      loginFailures.recordFailure(input.email);
      throw unauthorized('Email or password is incorrect');
    }
    if (this.mfa.isEnabled(user)) {
      // The failure count is NOT cleared here: only a finished sign-in clears it, so guessing the code is limited too.
      return { mfaRequired: true, mfaToken: await this.tokens.signMfaToken(user.id) };
    }
    loginFailures.reset(input.email);
    return this.continueSignIn(user);
  }

  /** The second step of sign-in for an account with two-step sign-in on: a current code, or a recovery code. */
  async loginWithMfa(input: MfaLogin): Promise<TokenPair | OrganizationChoice> {
    const userId = await this.tokens.verifyMfaToken(input.mfaToken);
    const [user] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    if (!user || user.status !== 'ACTIVE' || !this.mfa.isEnabled(user))
      throw unauthorized('The sign-in step is not valid');
    assertNotLocked(user.email);
    const ok = await this.mfa.checkSecondFactor(user, {
      code: input.code,
      recoveryCode: input.recoveryCode,
    });
    if (!ok) {
      loginFailures.recordFailure(user.email);
      throw unauthorized('That code is not right');
    }
    loginFailures.reset(user.email);
    return this.continueSignIn(user);
  }

  private async continueSignIn(user: UserRow): Promise<TokenPair | OrganizationChoice> {
    let memberships = await this.tenant.asUser(user.id, (tx) => this.membershipsOf(tx, user.id));
    if (memberships.length === 0) {
      // Someone removed from every organization still gets a workspace of their own to land in.
      await this.tenant.global((tx) => this.createPersonalOrganization(tx, user));
      memberships = await this.tenant.asUser(user.id, (tx) => this.membershipsOf(tx, user.id));
    }
    if (memberships.length === 1) return this.issue(user, memberships[0]!, randomUUID());
    return {
      organizationSelectionRequired: true,
      selectionToken: await this.tokens.signSelectionToken(user.id),
      organizations: memberships.map((m) => ({
        id: m.organizationId,
        name: m.organizationName,
        role: m.role,
      })),
    };
  }

  async selectOrganization(input: SelectOrganization): Promise<TokenPair> {
    const userId = await this.tokens.verifySelectionToken(input.selectionToken);
    const [user] = await this.tenant.global((tx) =>
      tx.select().from(users).where(eq(users.id, userId)),
    );
    if (!user || user.status !== 'ACTIVE') throw unauthorized('The account is not active');
    const memberships = await this.tenant.asUser(userId, (tx) => this.membershipsOf(tx, userId));
    const chosen = memberships.find((m) => m.organizationId === input.organizationId);
    if (!chosen) throw unauthorized('You do not belong to that organization');
    return this.issue(user, chosen, randomUUID());
  }

  /**
   * Sign in someone the identity provider vouches for (single sign-on). They land in their first organization. The provider's id for the person is
   * bound to the account at the first sign-in; after that the SAME email with a DIFFERENT id is refused (an address given to someone else later
   * must not inherit the account).
   *
   * Without `access` (the provider does not manage this application's access) the person must already have an active account here.
   * With it, the provider decides whether they may use JobPilot at all: without the `member` role they are refused (403); with it the account
   * and the person's own workspace are created at the first sign-in when missing. A person suspended here is still refused.
   */
  async loginWithVerifiedEmail(
    email: string,
    subject: string,
    access?: SsoAccess,
  ): Promise<TokenPair> {
    if (access && !hasAccessFromIdp(access.roles)) {
      throw forbidden(
        'You have not been given access to JobPilot. Ask an administrator to give you a role in the identity provider.',
      );
    }
    const find = () =>
      this.tenant.global((tx) => tx.select().from(users).where(eq(users.email, email)));
    let [user] = await find();
    if (!user && access) {
      try {
        user = await this.tenant.global(async (tx) => {
          const [row] = await tx
            .insert(users)
            .values({
              email,
              // Nobody knows this password: the account is for single sign-on until the person sets one.
              passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
              fullName: fullNameFrom(access, email),
            })
            .returning();
          await this.createPersonalOrganization(tx, row!);
          return row!;
        });
      } catch (e) {
        // Two first sign-ins at once: the other one created it.
        if (pgCode(e) !== '23505') throw e;
        [user] = await find();
      }
    }
    if (!user || user.status !== 'ACTIVE')
      throw unauthorized('There is no active account for this identity');
    if (user.ssoSubject && user.ssoSubject !== subject) {
      throw unauthorized(
        'This sign-in belongs to a different person than the account with that email',
      );
    }
    if (!user.ssoSubject) {
      try {
        await this.tenant.global((tx) =>
          tx.update(users).set({ ssoSubject: subject }).where(eq(users.id, user.id)),
        );
      } catch (e) {
        if (pgCode(e) === '23505')
          throw unauthorized('This sign-in is already bound to another account');
        throw e;
      }
    }
    let memberships = await this.tenant.asUser(user.id, (tx) => this.membershipsOf(tx, user.id));
    if (memberships.length === 0) {
      await this.tenant.global((tx) => this.createPersonalOrganization(tx, user));
      memberships = await this.tenant.asUser(user.id, (tx) => this.membershipsOf(tx, user.id));
    }
    return this.issue(user, memberships[0]!, randomUUID());
  }

  /**
   * The identity provider says this person signed out or was disabled there: end every session of the account (all refresh tokens, in every
   * organization; an access token lives at most its short lifetime). Answers the same for an id this app has never seen, so the call reveals nothing.
   */
  async revokeSessionsBySsoSubject(subject: string): Promise<number> {
    const revoked = await this.tenant.global((tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            isNull(refreshTokens.revokedAt),
            sql`${refreshTokens.userId} in (select id from users where sso_subject = ${subject})`,
          ),
        )
        .returning({ id: refreshTokens.id }),
    );
    return revoked.length;
  }

  async refresh(presented: string): Promise<TokenPair> {
    const hash = sha256(presented);
    type Outcome = TokenPair | 'reuse';
    const outcome = await this.tenant.global(async (tx): Promise<Outcome> => {
      const [token] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .for('update');
      if (!token) throw unauthorized('Refresh token is not valid');
      if (token.revokedAt) {
        // A spent token came back: someone holds a copy. Revoke the whole family. The revocation
        // has to commit, so the 401 is raised after the transaction ends.
        await tx
          .update(refreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(refreshTokens.familyId, token.familyId), isNull(refreshTokens.revokedAt)));
        return 'reuse';
      }
      if (token.expiresAt.getTime() <= Date.now()) throw unauthorized('Refresh token has expired');
      const [user] = await tx.select().from(users).where(eq(users.id, token.userId));
      if (!user || user.status !== 'ACTIVE') throw unauthorized('Refresh token is not valid');
      await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
      const membership = (await this.membershipsOf(tx, user.id)).find(
        (m) => m.organizationId === token.organizationId,
      );
      // Role and permissions are read again, so a demotion or removal takes effect at the next refresh.
      if (!membership) throw unauthorized('You no longer belong to that organization');
      await tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(eq(refreshTokens.id, token.id));
      return this.issue(user, membership, token.familyId, tx);
    });
    if (outcome === 'reuse') throw unauthorized('Refresh token was already used; sign in again');
    return outcome;
  }

  async logout(presented: string): Promise<void> {
    await this.tenant.global((tx) =>
      tx
        .update(refreshTokens)
        .set({ revokedAt: sql`now()` })
        .where(
          and(
            isNull(refreshTokens.revokedAt),
            sql`${refreshTokens.familyId} = (select family_id from refresh_tokens where token_hash = ${sha256(presented)})`,
          ),
        ),
    );
  }

  async me(p: Principal) {
    return this.tenant.inTenant(p, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, p.userId));
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, p.organizationId));
      if (!user || !org) throw unauthorized('The account no longer exists');
      return {
        user: { id: user.id, email: user.email, fullName: user.fullName },
        organization: { id: org.id, name: org.name, slug: org.slug, plan: org.plan },
        role: p.role,
        permissions: p.permissions,
      };
    });
  }

  // ---------- the organization and its members ----------

  async renameOrganization(p: Principal, input: UpdateOrganization) {
    return this.tenant.inTenant(p, async (tx) => {
      const [before] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, p.organizationId));
      const [after] = await tx
        .update(organizations)
        .set({ name: input.name })
        .where(eq(organizations.id, p.organizationId))
        .returning();
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'organization.renamed',
        resourceType: 'organization',
        resourceId: p.organizationId,
        before: { name: before?.name },
        after: { name: after?.name },
      });
      return { id: after!.id, name: after!.name, slug: after!.slug, plan: after!.plan };
    });
  }

  async listMembers(p: Principal): Promise<MemberDto[]> {
    return this.tenant.inTenant(p, (tx) => this.members(tx, p.organizationId, p.userId));
  }

  async addMember(p: Principal, input: AddMember): Promise<MemberDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const [target] = await tx.select().from(users).where(eq(users.email, input.email));
      // The platform administrator answers like an address nobody registered, to everyone but themselves.
      if (!target || (target.platformAdmin && target.id !== p.userId)) {
        throw notFound('Nobody has registered with that email; ask them to sign up first');
      }
      const role = await this.templateRole(tx, input.role);
      try {
        await tx.insert(organizationMembers).values({
          organizationId: p.organizationId,
          userId: target.id,
          roleId: role.id,
        });
      } catch (e) {
        if (pgCode(e) === '23505') {
          throw conflict('already-a-member', 'That person already belongs to this organization');
        }
        throw e;
      }
      // Counted after the insert, in the same transaction: over the limit rolls the new member back.
      await assertWithinQuota(tx, p.organizationId, 'members', true);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'member.added',
        resourceType: 'user',
        resourceId: target.id,
        after: { role: input.role },
      });
      return (await this.members(tx, p.organizationId, p.userId)).find(
        (m) => m.userId === target.id,
      )!;
    });
  }

  async updateMember(p: Principal, memberId: string, input: UpdateMember): Promise<MemberDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const [member] = await tx
        .select()
        .from(organizationMembers)
        .where(eq(organizationMembers.id, memberId))
        .for('update');
      if (!member) throw notFound(`Member ${memberId} does not exist`);
      const [account] = await tx
        .select({ platformAdmin: users.platformAdmin })
        .from(users)
        .where(eq(users.id, member.userId));
      // The platform administrator answers like an id that was never there to everyone but themselves.
      if (account?.platformAdmin && member.userId !== p.userId)
        throw notFound(`Member ${memberId} does not exist`);
      const [org] = await tx
        .select()
        .from(organizations)
        .where(eq(organizations.id, p.organizationId));
      if (member.userId === org!.ownerUserId) {
        throw new ProblemException(
          422,
          'owner-is-fixed',
          'The owner cannot be changed or removed',
          'Ownership transfer is a separate, deliberate step',
        );
      }
      const before = (await this.members(tx, p.organizationId, p.userId)).find(
        (m) => m.id === memberId,
      )!;
      const roleId = input.role ? (await this.templateRole(tx, input.role)).id : member.roleId;
      await tx
        .update(organizationMembers)
        .set({ roleId, status: input.status ?? member.status })
        .where(eq(organizationMembers.id, memberId));
      if (member.status === 'REMOVED' && input.status === 'ACTIVE') {
        await assertWithinQuota(tx, p.organizationId, 'members', true);
      }
      if (input.status === 'REMOVED') {
        // Their sessions in this organization end now, not at the next refresh.
        await tx
          .update(refreshTokens)
          .set({ revokedAt: sql`now()` })
          .where(
            and(
              eq(refreshTokens.userId, member.userId),
              eq(refreshTokens.organizationId, p.organizationId),
              isNull(refreshTokens.revokedAt),
            ),
          );
      }
      const after = (await this.members(tx, p.organizationId, p.userId)).find(
        (m) => m.id === memberId,
      )!;
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'member.updated',
        resourceType: 'user',
        resourceId: member.userId,
        before: { role: before.role, status: before.status },
        after: { role: after.role, status: after.status },
      });
      return after;
    });
  }

  // ---------- internals ----------

  private async createPersonalOrganization(tx: Tx, user: UserRow): Promise<void> {
    await tx.execute(sql`select set_config('app.user_id', ${user.id}, true)`);
    const [org] = await tx
      .insert(organizations)
      .values({
        slug: slugify(user.fullName),
        name: `${user.fullName}'s Workspace`,
        ownerUserId: user.id,
      })
      .returning();
    await setOrg(tx, org!.id);
    const owner = await this.templateRole(tx, 'OWNER');
    await tx
      .insert(organizationMembers)
      .values({ organizationId: org!.id, userId: user.id, roleId: owner.id });
    // In a personal workspace the person is also the candidate whose search it manages.
    await tx
      .insert(candidateProfiles)
      .values({ organizationId: org!.id, userId: user.id, fullName: user.fullName });
    await recordAudit(tx, {
      organizationId: org!.id,
      actorUserId: user.id,
      actorType: 'USER',
      action: 'organization.created',
      resourceType: 'organization',
      resourceId: org!.id,
      after: { name: org!.name },
    });
    await enqueue(tx, org!.id, 'organization.created', { organizationId: org!.id });
  }

  private async templateRole(tx: Tx, name: RoleName) {
    const [role] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.name, name), isNull(roles.organizationId)));
    if (!role) throw unprocessable('role-missing', 'Role template is missing', name);
    return role;
  }

  /** The organizations a user may enter, with their role and its permissions. Needs `app.user_id` set. */
  private async membershipsOf(tx: Tx, userId: string): Promise<Membership[]> {
    const rows = await tx
      .select({
        organizationId: organizationMembers.organizationId,
        organizationName: organizations.name,
        role: roles.name,
        permissions: roles.permissions,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(
        and(
          eq(organizationMembers.userId, userId),
          eq(organizationMembers.status, 'ACTIVE'),
          eq(organizations.status, 'ACTIVE'),
        ),
      )
      .orderBy(asc(organizations.createdAt), asc(organizations.id));
    return rows.map((r) => ({ ...r, permissions: r.permissions as Permission[] }));
  }

  /** The members of an organization as `viewerUserId` may see them: the platform administrator is in nobody else's list. */
  private async members(
    tx: Tx,
    organizationId: string,
    viewerUserId: string,
  ): Promise<MemberDto[]> {
    const rows = await tx
      .select({
        id: organizationMembers.id,
        userId: organizationMembers.userId,
        email: users.email,
        fullName: users.fullName,
        role: roles.name,
        status: organizationMembers.status,
        joinedAt: organizationMembers.joinedAt,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          or(eq(users.platformAdmin, false), eq(users.id, viewerUserId)),
        ),
      )
      .orderBy(asc(organizationMembers.joinedAt), asc(organizationMembers.id));
    return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
  }

  private async issue(
    user: UserRow,
    membership: Membership,
    familyId: string,
    tx?: Tx,
  ): Promise<TokenPair> {
    const refreshToken = randomBytes(32).toString('base64url');
    const store = (t: Tx) =>
      t.insert(refreshTokens).values({
        userId: user.id,
        organizationId: membership.organizationId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + this.config.refreshTtlSeconds * 1000),
      });
    if (tx) await store(tx);
    else await this.tenant.global((t) => store(t));
    const accessToken = await this.tokens.signAccessToken({
      userId: user.id,
      organizationId: membership.organizationId,
      role: membership.role,
      permissions: membership.permissions,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTtlSeconds,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      organization: {
        id: membership.organizationId,
        name: membership.organizationName,
        role: membership.role,
      },
    };
  }
}
