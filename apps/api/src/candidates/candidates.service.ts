import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, toPage } from '@jobpilot/kit';
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { escapeLike, pgCode, versionConflict } from '../common/errors.js';
import { enqueue, recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import type { Tx } from '../db/db.module.js';
import {
  candidateEducation,
  candidateExperience,
  candidateProfiles,
  candidateProjects,
  candidateSkills,
  users,
  type CandidateProfileRow,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { yearsOfExperience } from '../matching/score.js';
import type {
  ListProfilesQuery,
  ProfileDto,
  ProfileSummaryDto,
  UpdateProfile,
} from './candidates.contract.js';
import { CHILD_SCHEMAS } from './candidates.contract.js';
import type { z } from 'zod';

export type ChildKind = keyof typeof CHILD_SCHEMAS;

export const toSummary = (r: CandidateProfileRow): ProfileSummaryDto => ({
  id: r.id,
  userId: r.userId,
  fullName: r.fullName,
  headline: r.headline,
  summary: r.summary,
  targetRoles: r.targetRoles,
  targetLocations: r.targetLocations,
  salaryMin: r.salaryMin,
  salaryMax: r.salaryMax,
  workAuthStatus: r.workAuthStatus,
  remotePref: r.remotePref,
  relocationOk: r.relocationOk,
  version: r.version,
});

@Injectable()
export class CandidatesService {
  constructor(@Inject(TenantDb) private readonly tenant: TenantDb) {}

  /** Your own profile in this organization, created on first use. */
  async mine(p: Principal): Promise<ProfileDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const row = await this.ensureOwn(tx, p);
      return this.read(tx, row.id);
    });
  }

  async list(p: Principal, query: ListProfilesQuery) {
    return this.tenant.inTenant(p, async (tx) => {
      const where: SQL[] = [];
      // A candidate sees only themselves; everyone else with the permission sees the organization.
      if (p.role === 'CANDIDATE') where.push(eq(candidateProfiles.userId, p.userId));
      if (query.q) {
        const like = `%${escapeLike(query.q)}%`;
        where.push(
          or(
            ilike(candidateProfiles.fullName, like),
            ilike(candidateProfiles.headline, like),
          ) as SQL,
        );
      }
      const [rows, totals] = await Promise.all([
        tx
          .select()
          .from(candidateProfiles)
          .where(and(...where))
          .orderBy(asc(sql`lower(${candidateProfiles.fullName})`), asc(candidateProfiles.id))
          .limit(query.limit)
          .offset(query.offset),
        tx
          .select({ total: count() })
          .from(candidateProfiles)
          .where(and(...where)),
      ]);
      return toPage(rows.map(toSummary), totals[0]?.total ?? 0, query);
    });
  }

  async get(p: Principal, id: string): Promise<ProfileDto> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.visible(tx, p, id);
      return this.read(tx, id);
    });
  }

  async update(p: Principal, id: string, input: UpdateProfile): Promise<ProfileDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const before = await this.visible(tx, p, id, true);
      if (before.version !== input.version) {
        throw versionConflict('profile', before.version, input.version);
      }
      const changes: Partial<UpdateProfile> = { ...input };
      delete changes.version;
      const salaryMin = input.salaryMin === undefined ? before.salaryMin : input.salaryMin;
      const salaryMax = input.salaryMax === undefined ? before.salaryMax : input.salaryMax;
      if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
        throw conflict('salary-range', 'salaryMin must not exceed salaryMax');
      }
      await tx
        .update(candidateProfiles)
        .set({ ...changes, version: sql`${candidateProfiles.version} + 1`, updatedAt: sql`now()` })
        .where(eq(candidateProfiles.id, id));
      const after = await this.read(tx, id);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'candidate.updated',
        resourceType: 'candidate',
        resourceId: id,
        before: toSummary(before),
        after: { version: after.version, fullName: after.fullName, headline: after.headline },
      });
      await enqueue(tx, p.organizationId, 'candidate.updated', { candidateProfileId: id });
      return after;
    });
  }

  async addChild<K extends ChildKind>(
    p: Principal,
    id: string,
    kind: K,
    input: z.output<(typeof CHILD_SCHEMAS)[K]>,
  ): Promise<ProfileDto> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.visible(tx, p, id, true);
      const base = { organizationId: p.organizationId, candidateProfileId: id };
      try {
        if (kind === 'skills') {
          const v = input as z.output<typeof CHILD_SCHEMAS.skills>;
          await tx.insert(candidateSkills).values({
            ...base,
            skillName: v.skillName,
            category: v.category,
            proficiency: v.proficiency,
            yearsExperience: v.yearsExperience === undefined ? null : String(v.yearsExperience),
          });
        } else if (kind === 'experience') {
          const v = input as z.output<typeof CHILD_SCHEMAS.experience>;
          await tx.insert(candidateExperience).values({
            ...base,
            companyName: v.companyName,
            title: v.title,
            startDate: v.startDate,
            endDate: v.endDate ?? null,
            description: v.description ?? null,
            technologies: v.technologies,
          });
        } else if (kind === 'education') {
          const v = input as z.output<typeof CHILD_SCHEMAS.education>;
          await tx.insert(candidateEducation).values({
            ...base,
            institution: v.institution,
            degree: v.degree,
            field: v.field ?? null,
            startDate: v.startDate ?? null,
            endDate: v.endDate ?? null,
          });
        } else {
          const v = input as z.output<typeof CHILD_SCHEMAS.projects>;
          await tx.insert(candidateProjects).values({
            ...base,
            name: v.name,
            description: v.description ?? null,
            technologies: v.technologies,
            url: v.url ?? null,
          });
        }
      } catch (e) {
        if (pgCode(e) === '23505') throw conflict('duplicate', 'That entry already exists');
        throw e;
      }
      await tx
        .update(candidateProfiles)
        .set({ version: sql`${candidateProfiles.version} + 1`, updatedAt: sql`now()` })
        .where(eq(candidateProfiles.id, id));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: `candidate.${kind}-added`,
        resourceType: 'candidate',
        resourceId: id,
        after: input,
      });
      await enqueue(tx, p.organizationId, 'candidate.updated', { candidateProfileId: id });
      return this.read(tx, id);
    });
  }

  async removeChild(
    p: Principal,
    id: string,
    kind: ChildKind,
    childId: string,
  ): Promise<ProfileDto> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.visible(tx, p, id, true);
      const table = {
        skills: candidateSkills,
        experience: candidateExperience,
        education: candidateEducation,
        projects: candidateProjects,
      }[kind];
      const removed = await tx
        .delete(table)
        .where(and(eq(table.id, childId), eq(table.candidateProfileId, id)))
        .returning({ id: table.id });
      if (removed.length === 0) throw notFound(`No ${kind} entry ${childId} on this profile`);
      await tx
        .update(candidateProfiles)
        .set({ version: sql`${candidateProfiles.version} + 1`, updatedAt: sql`now()` })
        .where(eq(candidateProfiles.id, id));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: `candidate.${kind}-removed`,
        resourceType: 'candidate',
        resourceId: id,
        before: { childId },
      });
      await enqueue(tx, p.organizationId, 'candidate.updated', { candidateProfileId: id });
      return this.read(tx, id);
    });
  }

  // ---------- helpers ----------

  /** The profile if this person may see it (a candidate sees only their own), else a plain 404. */
  async visible(tx: Tx, p: Principal, id: string, forWrite = false): Promise<CandidateProfileRow> {
    const query = tx.select().from(candidateProfiles).where(eq(candidateProfiles.id, id));
    const [row] = forWrite ? await query.for('update') : await query;
    if (!row || (p.role === 'CANDIDATE' && row.userId !== p.userId)) {
      throw notFound(`Candidate ${id} does not exist`);
    }
    return row;
  }

  async ensureOwn(tx: Tx, p: Principal): Promise<CandidateProfileRow> {
    const [existing] = await tx
      .select()
      .from(candidateProfiles)
      .where(
        and(
          eq(candidateProfiles.userId, p.userId),
          eq(candidateProfiles.organizationId, p.organizationId),
        ),
      );
    if (existing) return existing;
    const [user] = await tx.select().from(users).where(eq(users.id, p.userId));
    const [created] = await tx
      .insert(candidateProfiles)
      .values({
        organizationId: p.organizationId,
        userId: p.userId,
        fullName: user?.fullName ?? 'Candidate',
      })
      .returning();
    return created!;
  }

  async read(tx: Tx, id: string): Promise<ProfileDto> {
    const [profile] = await tx.select().from(candidateProfiles).where(eq(candidateProfiles.id, id));
    if (!profile) throw notFound(`Candidate ${id} does not exist`);
    const [skills, experience, education, projects] = await Promise.all([
      tx
        .select()
        .from(candidateSkills)
        .where(eq(candidateSkills.candidateProfileId, id))
        .orderBy(asc(sql`lower(${candidateSkills.skillName})`)),
      tx
        .select()
        .from(candidateExperience)
        .where(eq(candidateExperience.candidateProfileId, id))
        .orderBy(sql`${candidateExperience.startDate} desc`),
      tx.select().from(candidateEducation).where(eq(candidateEducation.candidateProfileId, id)),
      tx.select().from(candidateProjects).where(eq(candidateProjects.candidateProfileId, id)),
    ]);
    return {
      ...toSummary(profile),
      yearsExperience: yearsOfExperience(experience),
      skills: skills.map((s) => ({
        id: s.id,
        skillName: s.skillName,
        category: s.category,
        proficiency: s.proficiency,
        yearsExperience: s.yearsExperience === null ? null : Number(s.yearsExperience),
      })),
      experience: experience.map((e) => ({
        id: e.id,
        companyName: e.companyName,
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        description: e.description,
        technologies: e.technologies,
      })),
      education: education.map((e) => ({
        id: e.id,
        institution: e.institution,
        degree: e.degree,
        field: e.field,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      projects: projects.map((x) => ({
        id: x.id,
        name: x.name,
        description: x.description,
        technologies: x.technologies,
        url: x.url,
      })),
    };
  }
}
