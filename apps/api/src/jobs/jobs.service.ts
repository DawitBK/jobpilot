import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@jobpilot/kit';
import { and, asc, count, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import { enqueue, recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { escapeLike, pgCode, versionConflict } from '../common/errors.js';
import type { Tx } from '../db/db.module.js';
import {
  candidateProfiles,
  companies,
  jobMatches,
  jobs,
  jobSources,
  rawJobs,
  type JobRow,
  type JobSourceRow,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { MatchingService } from '../matching/matching.service.js';
import { normalizeSkill } from '../matching/score.js';
import { CONNECTORS, JOB_FEED_FETCHER, type JobFeedFetcher } from './feeds.js';
import { dedupHashOf, normalizeCompany, normalizePosting } from './normalize.js';
import type {
  CreateJob,
  CreateSource,
  JobDto,
  JobSortField,
  ListJobsQuery,
  ListMatchesQuery,
  MatchDto,
  RunResult,
  SourceDto,
  UpdateJob,
  UpdateSource,
} from './jobs.contract.js';

const SORT = {
  postedAt: jobs.postedAt,
  title: sql`lower(${jobs.title})`,
} satisfies Record<JobSortField, unknown>;

const toJobDto = (r: JobRow, companyName: string): JobDto => ({
  id: r.id,
  companyId: r.companyId,
  companyName,
  sourceId: r.sourceId,
  title: r.title,
  description: r.description,
  location: r.location,
  remoteType: r.remoteType,
  salaryMin: r.salaryMin,
  salaryMax: r.salaryMax,
  seniority: r.seniority,
  employmentType: r.employmentType,
  requiredSkills: r.requiredSkills,
  preferredSkills: r.preferredSkills,
  visaSponsorship: r.visaSponsorship,
  applicationUrl: r.applicationUrl,
  postedAt: r.postedAt.toISOString(),
  status: r.status,
  version: r.version,
});

const toSourceDto = (r: JobSourceRow): SourceDto => ({
  id: r.id,
  type: r.type,
  name: r.name,
  config: r.config,
  enabled: r.enabled,
  pollIntervalMinutes: r.pollIntervalMinutes,
  lastRunAt: r.lastRunAt?.toISOString() ?? null,
  lastRunStatus: r.lastRunStatus,
  lastRunMessage: r.lastRunMessage,
  version: r.version,
});

const skillsOf = (list: string[]) => [...new Set(list.map(normalizeSkill))];

async function upsertCompany(tx: Tx, name: string): Promise<{ id: string; name: string }> {
  const [row] = await tx
    .insert(companies)
    .values({ name: name.trim(), normalizedName: normalizeCompany(name) })
    .onConflictDoUpdate({
      target: companies.normalizedName,
      // A no-op update, so the existing row is returned either way.
      set: { normalizedName: sql`excluded.normalized_name` },
    })
    .returning();
  return { id: row!.id, name: row!.name };
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(MatchingService) private readonly matching: MatchingService,
    @Inject(JOB_FEED_FETCHER) private readonly fetcher: JobFeedFetcher,
  ) {}

  // ---------- jobs ----------

  async createJob(p: Principal, input: CreateJob): Promise<JobDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const company = await upsertCompany(tx, input.companyName);
      const dedupHash = dedupHashOf(company.name, input.title, input.location ?? null);
      const [row] = await tx
        .insert(jobs)
        .values({
          organizationId: p.organizationId,
          companyId: company.id,
          title: input.title,
          description: input.description,
          location: input.location ?? null,
          remoteType: input.remoteType,
          salaryMin: input.salaryMin ?? null,
          salaryMax: input.salaryMax ?? null,
          seniority: input.seniority ?? null,
          employmentType: input.employmentType,
          requiredSkills: skillsOf(input.requiredSkills),
          preferredSkills: skillsOf(input.preferredSkills),
          visaSponsorship: input.visaSponsorship ?? null,
          applicationUrl: input.applicationUrl ?? null,
          dedupHash,
        })
        .onConflictDoNothing({ target: [jobs.organizationId, jobs.dedupHash] })
        .returning();
      if (!row) {
        const [existing] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.organizationId, p.organizationId), eq(jobs.dedupHash, dedupHash)));
        throw new ProblemException(
          409,
          'job-exists',
          'That job is already on file',
          'The same company, title and location was added before',
          { jobId: existing?.id },
        );
      }
      await this.matching.scoreJobs(tx, p.organizationId, [row]);
      const dto = toJobDto(row, company.name);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'job.created',
        resourceType: 'job',
        resourceId: dto.id,
        after: { title: dto.title, company: dto.companyName },
      });
      await enqueue(tx, p.organizationId, 'job.created', { jobId: dto.id });
      return dto;
    });
  }

  async listJobs(p: Principal, query: ListJobsQuery) {
    return this.tenant.inTenant(p, async (tx) => {
      const where: SQL[] = [];
      where.push(eq(jobs.status, query.status ?? 'ACTIVE'));
      if (query.remoteType) where.push(eq(jobs.remoteType, query.remoteType));
      if (query.skill) {
        where.push(sql`${jobs.requiredSkills} @> ARRAY[${normalizeSkill(query.skill)}]::text[]`);
      }
      if (query.q) {
        const like = `%${escapeLike(query.q)}%`;
        where.push(
          or(
            ilike(jobs.title, like),
            ilike(jobs.description, like),
            ilike(companies.name, like),
          ) as SQL,
        );
      }
      const order = [
        ...query.sort.map((s) => (s.direction === 'asc' ? asc : desc)(SORT[s.field] as SQL)),
        asc(jobs.id),
      ];
      const [rows, totals] = await Promise.all([
        tx
          .select({ job: jobs, companyName: companies.name })
          .from(jobs)
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .where(and(...where))
          .orderBy(...order)
          .limit(query.limit)
          .offset(query.offset),
        tx
          .select({ total: count() })
          .from(jobs)
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .where(and(...where)),
      ]);
      return toPage(
        rows.map((r) => toJobDto(r.job, r.companyName)),
        totals[0]?.total ?? 0,
        query,
      );
    });
  }

  async getJob(p: Principal, id: string): Promise<JobDto> {
    return this.tenant.inTenant(p, (tx) => this.readJob(tx, id));
  }

  async updateJob(p: Principal, id: string, input: UpdateJob): Promise<JobDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const [current] = await tx.select().from(jobs).where(eq(jobs.id, id)).for('update');
      if (!current) throw notFound(`Job ${id} does not exist`);
      if (current.version !== input.version) {
        throw versionConflict('job', current.version, input.version);
      }
      const before = await this.readJob(tx, id);
      const salaryMin = input.salaryMin === undefined ? current.salaryMin : input.salaryMin;
      const salaryMax = input.salaryMax === undefined ? current.salaryMax : input.salaryMax;
      if (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax) {
        throw unprocessable('salary-range', 'salaryMin must not exceed salaryMax');
      }
      const { version: _v, ...rest } = input;
      void _v;
      const title = input.title ?? current.title;
      const location = input.location === undefined ? current.location : input.location;
      try {
        await tx
          .update(jobs)
          .set({
            ...rest,
            ...(input.requiredSkills ? { requiredSkills: skillsOf(input.requiredSkills) } : {}),
            ...(input.preferredSkills ? { preferredSkills: skillsOf(input.preferredSkills) } : {}),
            dedupHash: dedupHashOf(before.companyName, title, location),
            version: sql`${jobs.version} + 1`,
          })
          .where(eq(jobs.id, id));
      } catch (e) {
        if (pgCode(e) === '23505')
          throw conflict('job-exists', 'Another job already has that title and place');
        throw e;
      }
      const [row] = await tx.select().from(jobs).where(eq(jobs.id, id));
      // The facts changed, so what it means to every candidate may have too.
      await this.matching.scoreJobs(tx, p.organizationId, [row!]);
      const after = await this.readJob(tx, id);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'job.updated',
        resourceType: 'job',
        resourceId: id,
        before: { title: before.title, status: before.status },
        after: { title: after.title, status: after.status },
      });
      return after;
    });
  }

  // ---------- sources ----------

  async createSource(p: Principal, input: CreateSource): Promise<SourceDto> {
    const problem = CONNECTORS[input.type].validateConfig(input.config);
    if (problem)
      throw unprocessable('invalid-source-config', 'The source settings are not valid', problem);
    return this.tenant.inTenant(p, async (tx) => {
      try {
        const [row] = await tx
          .insert(jobSources)
          .values({
            organizationId: p.organizationId,
            type: input.type,
            name: input.name,
            config: input.config,
            pollIntervalMinutes: input.pollIntervalMinutes,
          })
          .returning();
        const dto = toSourceDto(row!);
        await recordAudit(tx, {
          organizationId: p.organizationId,
          actorUserId: p.userId,
          actorType: 'USER',
          action: 'source.created',
          resourceType: 'job-source',
          resourceId: dto.id,
          after: { type: dto.type, name: dto.name },
        });
        return dto;
      } catch (e) {
        if (pgCode(e) === '23505') throw conflict('name-taken', 'A source with this name exists');
        throw e;
      }
    });
  }

  async listSources(p: Principal): Promise<SourceDto[]> {
    return this.tenant.inTenant(p, async (tx) => {
      const rows = await tx
        .select()
        .from(jobSources)
        .orderBy(asc(sql`lower(${jobSources.name})`));
      return rows.map(toSourceDto);
    });
  }

  async updateSource(p: Principal, id: string, input: UpdateSource): Promise<SourceDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const [current] = await tx
        .select()
        .from(jobSources)
        .where(eq(jobSources.id, id))
        .for('update');
      if (!current) throw notFound(`Source ${id} does not exist`);
      if (current.version !== input.version) {
        throw versionConflict('source', current.version, input.version);
      }
      if (input.config) {
        const problem = CONNECTORS[current.type].validateConfig(input.config);
        if (problem)
          throw unprocessable(
            'invalid-source-config',
            'The source settings are not valid',
            problem,
          );
      }
      const { version: _v, ...changes } = input;
      void _v;
      const [row] = await tx
        .update(jobSources)
        .set({ ...changes, version: sql`${jobSources.version} + 1` })
        .where(eq(jobSources.id, id))
        .returning();
      const after = toSourceDto(row!);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'source.updated',
        resourceType: 'job-source',
        resourceId: id,
        before: toSourceDto(current),
        after,
      });
      return after;
    });
  }

  async deleteSource(p: Principal, id: string): Promise<void> {
    await this.tenant.inTenant(p, async (tx) => {
      const [current] = await tx
        .select()
        .from(jobSources)
        .where(eq(jobSources.id, id))
        .for('update');
      if (!current) throw notFound(`Source ${id} does not exist`);
      const [{ used } = { used: 0 }] = await tx
        .select({ used: count() })
        .from(jobs)
        .where(eq(jobs.sourceId, id));
      if (used > 0) {
        throw conflict(
          'source-has-jobs',
          'Jobs came from this source',
          'Disable it instead, so the history of where jobs came from is kept',
        );
      }
      await tx.delete(rawJobs).where(eq(rawJobs.sourceId, id));
      await tx.delete(jobSources).where(eq(jobSources.id, id));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'source.deleted',
        resourceType: 'job-source',
        resourceId: id,
        before: toSourceDto(current),
      });
    });
  }

  /**
   * Poll a source now: fetch (outside any transaction, since it is the network), then in one
   * transaction store the raw postings, understand them, drop duplicates, add the new jobs and
   * score them against every candidate in the organization.
   */
  async runSource(p: Principal, id: string): Promise<RunResult> {
    const source = await this.tenant.inTenant(p, async (tx) => {
      const [row] = await tx.select().from(jobSources).where(eq(jobSources.id, id));
      if (!row) throw notFound(`Source ${id} does not exist`);
      return row;
    });
    if (!source.enabled) throw conflict('source-disabled', 'The source is disabled');
    const connector = CONNECTORS[source.type];

    let postings;
    try {
      postings = await connector.fetch(source.config, this.fetcher);
    } catch (e) {
      const message = (e as Error).message.slice(0, 300);
      await this.tenant.inTenant(p, async (tx) => {
        await tx
          .update(jobSources)
          .set({ lastRunAt: sql`now()`, lastRunStatus: 'ERROR', lastRunMessage: message })
          .where(eq(jobSources.id, id));
      });
      throw new ProblemException(
        502,
        'source-fetch-failed',
        'The source could not be read',
        message,
      );
    }

    return this.tenant.inTenant(p, async (tx) => {
      const result: RunResult = {
        fetched: postings.length,
        created: 0,
        duplicates: 0,
        discarded: 0,
        matched: 0,
      };
      const createdJobs: JobRow[] = [];
      for (const raw of postings) {
        const job = raw.title?.trim() && raw.company?.trim() ? normalizePosting(raw) : null;
        await tx.insert(rawJobs).values({
          organizationId: p.organizationId,
          sourceId: id,
          rawPayload: JSON.parse(JSON.stringify(raw)),
          dedupHash: job?.dedupHash ?? 'unparseable',
          status: job ? 'PROCESSED' : 'DISCARDED',
          processedAt: sql`now()`,
        });
        if (!job) {
          result.discarded += 1;
          continue;
        }
        const company = await upsertCompany(tx, job.companyName);
        const [row] = await tx
          .insert(jobs)
          .values({
            organizationId: p.organizationId,
            companyId: company.id,
            sourceId: id,
            externalId: job.externalId,
            title: job.title,
            description: job.description,
            location: job.location,
            remoteType: job.remoteType,
            salaryMin: job.salaryMin,
            salaryMax: job.salaryMax,
            seniority: job.seniority,
            requiredSkills: job.requiredSkills,
            preferredSkills: job.preferredSkills,
            visaSponsorship: job.visaSponsorship,
            applicationUrl: job.applicationUrl,
            postedAt: job.postedAt ?? new Date(),
            dedupHash: job.dedupHash,
          })
          .onConflictDoNothing({ target: [jobs.organizationId, jobs.dedupHash] })
          .returning();
        if (row) {
          createdJobs.push(row);
          result.created += 1;
        } else {
          result.duplicates += 1;
        }
      }
      result.matched = await this.matching.scoreJobs(tx, p.organizationId, createdJobs);
      await tx
        .update(jobSources)
        .set({
          lastRunAt: sql`now()`,
          lastRunStatus: 'OK',
          lastRunMessage: `${result.created} new, ${result.duplicates} already known, ${result.discarded} discarded`,
        })
        .where(eq(jobSources.id, id));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'source.run',
        resourceType: 'job-source',
        resourceId: id,
        after: result,
      });
      if (result.created > 0) {
        await enqueue(tx, p.organizationId, 'jobs.discovered', {
          sourceId: id,
          created: result.created,
        });
      }
      return result;
    });
  }

  // ---------- matches ----------

  async listMatches(p: Principal, query: ListMatchesQuery) {
    return this.tenant.inTenant(p, async (tx) => {
      const where: SQL[] = [];
      if (p.role === 'CANDIDATE') {
        where.push(
          sql`${jobMatches.candidateProfileId} in (select id from candidate_profiles where user_id = ${p.userId})`,
        );
      }
      if (query.candidateProfileId)
        where.push(eq(jobMatches.candidateProfileId, query.candidateProfileId));
      if (query.recommendation) where.push(eq(jobMatches.recommendation, query.recommendation));
      if (query.minScore !== undefined)
        where.push(gte(jobMatches.overallScore, String(query.minScore)));
      const [rows, totals] = await Promise.all([
        tx
          .select({ m: jobMatches, title: jobs.title, companyName: companies.name })
          .from(jobMatches)
          .innerJoin(jobs, eq(jobs.id, jobMatches.jobId))
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .where(and(...where))
          .orderBy(desc(jobMatches.overallScore), asc(jobMatches.id))
          .limit(query.limit)
          .offset(query.offset),
        tx
          .select({ total: count() })
          .from(jobMatches)
          .where(and(...where)),
      ]);
      const items: MatchDto[] = rows.map(({ m, title, companyName }) => ({
        id: m.id,
        jobId: m.jobId,
        jobTitle: title,
        companyName,
        candidateProfileId: m.candidateProfileId,
        overallScore: Number(m.overallScore),
        technicalScore: Number(m.technicalScore),
        locationScore: Number(m.locationScore),
        salaryScore: Number(m.salaryScore),
        seniorityScore: Number(m.seniorityScore),
        missingSkills: m.missingSkills,
        strongEvidence: m.strongEvidence,
        hardFilters: m.hardFilters,
        recommendation: m.recommendation,
        scoringVersion: m.scoringVersion,
      }));
      return toPage(items, totals[0]?.total ?? 0, query);
    });
  }

  /** Score every active job again for one candidate (after their profile changed). */
  async rescore(p: Principal, candidateProfileId?: string): Promise<{ matches: number }> {
    return this.tenant.inTenant(p, async (tx) => {
      const own = await tx
        .select({ id: candidateProfiles.id })
        .from(candidateProfiles)
        .where(
          p.role === 'CANDIDATE'
            ? eq(candidateProfiles.userId, p.userId)
            : candidateProfileId
              ? eq(candidateProfiles.id, candidateProfileId)
              : sql`true`,
        );
      const ids = candidateProfileId ? own.filter((o) => o.id === candidateProfileId) : own;
      if (candidateProfileId && ids.length === 0)
        throw notFound(`Candidate ${candidateProfileId} does not exist`);
      let matches = 0;
      for (const row of ids)
        matches += await this.matching.rescoreCandidate(tx, p.organizationId, row.id);
      return { matches };
    });
  }

  private async readJob(tx: Tx, id: string): Promise<JobDto> {
    const [r] = await tx
      .select({ job: jobs, companyName: companies.name })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(jobs.id, id));
    if (!r) throw notFound(`Job ${id} does not exist`);
    return toJobDto(r.job, r.companyName);
  }
}
