import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@jobpilot/kit';
import { and, asc, count, desc, eq, gte, ilike, or, sql, type SQL } from 'drizzle-orm';
import { assertWithinQuota } from '../billing/quota.js';
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
  sourceRuns,
  type JobRow,
  type JobSourceRow,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { MatchingService } from '../matching/matching.service.js';
import { normalizeSkill } from '../matching/score.js';
import { buildConfig, CATALOG, entryById } from './catalog.js';
import { CONNECTORS } from './connectors/index.js';
import { importPostingFromUrl } from './connectors/generic.js';
import { JOB_FEED_FETCHER, type JobFeedFetcher } from './feeds.js';
import { applyFilters, NO_FILTERS, sourceFiltersSchema } from './filters.js';
import { dedupHashOf, normalizeCompany, normalizePosting, type RawPosting } from './normalize.js';
import type {
  CatalogEntryDto,
  CreateFromCatalog,
  CreateJob,
  CreateSource,
  ImportLinks,
  ImportResult,
  JobDto,
  JobSortField,
  ListJobsQuery,
  ListMatchesQuery,
  MatchDto,
  PreviewResult,
  PreviewSource,
  RunResult,
  SourceDto,
  SourceRunDto,
  UpdateJob,
  UpdateSource,
} from './jobs.contract.js';

/** Who a source is read for: a person pressing "Read now", or the schedule (no person). */
export interface RunScope {
  organizationId: string;
  userId: string | null;
}
export type RunTrigger = 'MANUAL' | 'SCHEDULE';

const NIL_USER = '00000000-0000-0000-0000-000000000000';
const BACKOFF_CAP_MINUTES = 24 * 60;
const URL_IN_TEXT = /https:\/\/[^\s<>"')\]]+/gi;

/** The wait after a failed read: the source's own interval, doubled for each failure in a row, at most a day. */
export const retryAfterMinutes = (pollMinutes: number, failures: number): number =>
  Math.min(pollMinutes * 2 ** Math.min(failures, 10), BACKOFF_CAP_MINUTES);

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
  filters: sourceFiltersSchema.catch(NO_FILTERS).parse(r.filters),
  presetId: r.presetId,
  nextRunAt: r.nextRunAt?.toISOString() ?? null,
  consecutiveFailures: r.consecutiveFailures,
  version: r.version,
});

const toRunDto = (r: typeof sourceRuns.$inferSelect): SourceRunDto => ({
  id: r.id,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  status: r.status,
  trigger: r.trigger,
  fetched: r.fetched,
  created: r.created,
  duplicates: r.duplicates,
  filtered: r.filtered,
  discarded: r.discarded,
  message: r.message,
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
            filters: input.filters,
            presetId: input.presetId ?? null,
          })
          .returning();
        await assertWithinQuota(tx, p.organizationId, 'sources', true);
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
      // Switching a source back on, or changing how it is read, clears a back-off: try again at once.
      const retry =
        input.enabled === true || input.config ? { nextRunAt: null, consecutiveFailures: 0 } : {};
      const [row] = await tx
        .update(jobSources)
        .set({ ...changes, ...retry, version: sql`${jobSources.version} + 1` })
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

  /** Read a source now, as the person who pressed the button. */
  async runSource(p: Principal, id: string): Promise<RunResult> {
    return this.execute({ organizationId: p.organizationId, userId: p.userId }, id, 'MANUAL');
  }

  /**
   * Read one source: fetch (outside any transaction, since it is the network), then in one transaction
   * keep what the filters allow, store the raw postings, understand them, drop duplicates, add the new
   * jobs and score them against every candidate. Every read leaves a line in the run history, and a
   * failing source waits longer before the next scheduled read.
   */
  async execute(scope: RunScope, id: string, trigger: RunTrigger): Promise<RunResult> {
    const tenantScope = { organizationId: scope.organizationId, userId: scope.userId ?? NIL_USER };
    const source = await this.tenant.inTenant(tenantScope, async (tx) => {
      const [row] = await tx.select().from(jobSources).where(eq(jobSources.id, id));
      if (!row) throw notFound(`Source ${id} does not exist`);
      return row;
    });
    if (!source.enabled) throw conflict('source-disabled', 'The source is disabled');
    const startedAt = new Date();
    const filters = sourceFiltersSchema.catch(NO_FILTERS).parse(source.filters);

    let postings: RawPosting[];
    try {
      postings = await CONNECTORS[source.type].fetch(source.config, this.fetcher);
    } catch (e) {
      const message = (e as Error).message.slice(0, 300);
      await this.tenant.inTenant(tenantScope, async (tx) => {
        const failures = source.consecutiveFailures + 1;
        await tx
          .update(jobSources)
          .set({
            lastRunAt: sql`now()`,
            lastRunStatus: 'ERROR',
            lastRunMessage: message,
            consecutiveFailures: failures,
            nextRunAt: sql`now() + make_interval(mins => ${retryAfterMinutes(source.pollIntervalMinutes, failures)})`,
          })
          .where(eq(jobSources.id, id));
        await tx.insert(sourceRuns).values({
          organizationId: scope.organizationId,
          sourceId: id,
          startedAt,
          finishedAt: sql`now()`,
          status: 'ERROR',
          trigger,
          message,
        });
      });
      throw new ProblemException(
        502,
        'source-fetch-failed',
        'The source could not be read',
        message,
      );
    }

    return this.tenant.inTenant(tenantScope, async (tx) => {
      const { kept, dropped } = applyFilters(postings, filters);
      const stored = await this.storePostings(tx, scope.organizationId, id, kept);
      const result: RunResult = {
        fetched: postings.length,
        created: stored.created,
        duplicates: stored.duplicates,
        filtered: dropped,
        discarded: stored.discarded,
        matched: stored.matched,
      };
      const message = `${result.created} new, ${result.duplicates} already known${
        result.filtered ? `, ${result.filtered} filtered out` : ''
      }${result.discarded ? `, ${result.discarded} discarded` : ''}`;
      await tx
        .update(jobSources)
        .set({
          lastRunAt: sql`now()`,
          lastRunStatus: 'OK',
          lastRunMessage: message,
          consecutiveFailures: 0,
          nextRunAt: sql`now() + make_interval(mins => ${source.pollIntervalMinutes})`,
        })
        .where(eq(jobSources.id, id));
      await tx.insert(sourceRuns).values({
        organizationId: scope.organizationId,
        sourceId: id,
        startedAt,
        finishedAt: sql`now()`,
        status: 'OK',
        trigger,
        fetched: result.fetched,
        created: result.created,
        duplicates: result.duplicates,
        filtered: result.filtered,
        discarded: result.discarded,
        message,
      });
      await recordAudit(tx, {
        organizationId: scope.organizationId,
        actorUserId: scope.userId,
        actorType: scope.userId ? 'USER' : 'SYSTEM',
        action: 'source.run',
        resourceType: 'job-source',
        resourceId: id,
        after: { ...result, trigger },
      });
      if (result.created > 0) {
        await enqueue(tx, scope.organizationId, 'jobs.discovered', {
          sourceId: id,
          created: result.created,
        });
      }
      return result;
    });
  }

  /** Understand postings, drop the ones already on file, add the rest and score them. `sourceId` is null for a job added by hand from a link. */
  private async storePostings(
    tx: Tx,
    organizationId: string,
    sourceId: string | null,
    postings: RawPosting[],
  ): Promise<RunResult & { jobs: { raw: RawPosting; row: JobRow | null; hash: string }[] }> {
    const out = { fetched: postings.length, created: 0, duplicates: 0, filtered: 0, discarded: 0 };
    const createdJobs: JobRow[] = [];
    const seen: { raw: RawPosting; row: JobRow | null; hash: string }[] = [];
    for (const raw of postings) {
      const job = raw.title?.trim() && raw.company?.trim() ? normalizePosting(raw) : null;
      if (sourceId) {
        await tx.insert(rawJobs).values({
          organizationId,
          sourceId,
          rawPayload: JSON.parse(JSON.stringify(raw)),
          dedupHash: job?.dedupHash ?? 'unparseable',
          status: job ? 'PROCESSED' : 'DISCARDED',
          processedAt: sql`now()`,
        });
      }
      if (!job) {
        out.discarded += 1;
        continue;
      }
      const company = await upsertCompany(tx, job.companyName);
      const [row] = await tx
        .insert(jobs)
        .values({
          organizationId,
          companyId: company.id,
          sourceId,
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
        out.created += 1;
      } else {
        out.duplicates += 1;
      }
      seen.push({ raw, row: row ?? null, hash: job.dedupHash });
    }
    const matched = await this.matching.scoreJobs(tx, organizationId, createdJobs);
    return { ...out, matched, jobs: seen };
  }

  // ---------- the catalog, trying a source, and adding jobs from links ----------

  catalog(): CatalogEntryDto[] {
    return CATALOG.map((entry) => {
      const { fixed, ...visible } = entry;
      void fixed;
      return visible;
    });
  }

  /** Read a source without saving anything: what it would bring, so the person can judge before adding it. */
  async preview(input: PreviewSource): Promise<PreviewResult> {
    const { type, config } = this.resolve(input);
    let postings: RawPosting[];
    try {
      postings = await CONNECTORS[type].fetch(config, this.fetcher);
    } catch (e) {
      throw new ProblemException(
        502,
        'source-fetch-failed',
        'The source could not be read',
        (e as Error).message.slice(0, 300),
      );
    }
    const { kept, dropped } = applyFilters(postings, input.filters);
    return {
      fetched: postings.length,
      kept: kept.length,
      filtered: dropped,
      type,
      config,
      sample: kept.slice(0, 8).map((r) => ({
        title: r.title,
        company: r.company,
        location: r.location,
        url: r.url,
        postedAt: r.postedAt?.toISOString() ?? null,
      })),
    };
  }

  async createFromCatalog(p: Principal, input: CreateFromCatalog): Promise<SourceDto> {
    const { type, config, entryName } = this.resolve({
      presetId: input.presetId,
      values: input.values,
    });
    // The account or company the person named tells their sources apart; a page count or a choice does not.
    const named = entryById(input.presetId)?.fields.find(
      (f) => f.required && f.kind === 'text' && (input.values[f.key] ?? '').trim(),
    );
    const hint = named ? input.values[named.key]!.trim() : undefined;
    return this.createSource(p, {
      type,
      config,
      name: input.name ?? (hint && hint.length <= 40 ? `${entryName} (${hint})` : entryName),
      pollIntervalMinutes: input.pollIntervalMinutes,
      filters: input.filters,
      presetId: input.presetId,
    });
  }

  private resolve(input: {
    presetId?: string;
    values?: Record<string, string>;
    type?: PreviewSource['type'];
    config?: Record<string, string>;
  }) {
    if (input.presetId) {
      const entry = entryById(input.presetId);
      if (!entry) throw notFound(`There is no catalog entry ${input.presetId}`);
      const built = buildConfig(entry, input.values ?? {});
      if ('problem' in built)
        throw unprocessable(
          'invalid-source-config',
          'The source settings are not valid',
          built.problem,
        );
      return { type: entry.type!, config: built.config, entryName: entry.name };
    }
    const type = input.type!;
    const config = input.config!;
    const problem = CONNECTORS[type].validateConfig(config);
    if (problem)
      throw unprocessable('invalid-source-config', 'The source settings are not valid', problem);
    return { type, config, entryName: type };
  }

  /** Add jobs from their own pages: for sites that offer no feed, or a link a friend sent. */
  async importLinks(p: Principal, input: ImportLinks): Promise<ImportResult> {
    const urls = [
      ...new Set([
        ...input.urls,
        ...(input.text?.match(URL_IN_TEXT) ?? []).map((u) => u.replace(/[.,;:!?]+$/, '')),
      ]),
    ].slice(0, 20);
    if (urls.length === 0)
      throw unprocessable('no-links', 'No links were found', 'Paste at least one https link');
    const results: ImportResult['results'] = [];
    for (const url of urls) {
      let raw: RawPosting;
      try {
        raw = await importPostingFromUrl(url, this.fetcher);
      } catch (e) {
        results.push({
          url,
          outcome: 'FAILED',
          jobId: null,
          title: null,
          company: null,
          message: (e as Error).message.slice(0, 300),
        });
        continue;
      }
      results.push(
        await this.tenant.inTenant(p, async (tx) => {
          const stored = await this.storePostings(tx, p.organizationId, null, [raw]);
          const one = stored.jobs[0];
          let jobId = one?.row?.id ?? null;
          if (one && !one.row) {
            const [existing] = await tx
              .select({ id: jobs.id })
              .from(jobs)
              .where(and(eq(jobs.organizationId, p.organizationId), eq(jobs.dedupHash, one.hash)));
            jobId = existing?.id ?? null;
          }
          if (stored.created > 0) {
            await recordAudit(tx, {
              organizationId: p.organizationId,
              actorUserId: p.userId,
              actorType: 'USER',
              action: 'job.imported',
              resourceType: 'job',
              resourceId: jobId!,
              after: { url, title: raw.title, company: raw.company },
            });
            await enqueue(tx, p.organizationId, 'job.created', { jobId });
          }
          return {
            url,
            outcome: stored.created > 0 ? ('ADDED' as const) : ('ALREADY_KNOWN' as const),
            jobId,
            title: raw.title,
            company: raw.company,
            message: stored.discarded > 0 ? 'The page has no job title or company to read' : null,
          };
        }),
      );
    }
    return { results };
  }

  async listRuns(p: Principal, sourceId: string): Promise<SourceRunDto[]> {
    return this.tenant.inTenant(p, async (tx) => {
      const [source] = await tx
        .select({ id: jobSources.id })
        .from(jobSources)
        .where(eq(jobSources.id, sourceId));
      if (!source) throw notFound(`Source ${sourceId} does not exist`);
      const rows = await tx
        .select()
        .from(sourceRuns)
        .where(eq(sourceRuns.sourceId, sourceId))
        .orderBy(desc(sourceRuns.startedAt))
        .limit(20);
      return rows.map(toRunDto);
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
      if (query.jobId) where.push(eq(jobMatches.jobId, query.jobId));
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
