import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException, toPage, unprocessable } from '@jobpilot/kit';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../common/auth.js';
import { assertWithinQuota } from '../billing/quota.js';
import { PolicyService } from '../policy/policy.service.js';
import { pgCode } from '../common/errors.js';
import type { Tx } from '../db/db.module.js';
import {
  applicationEvents,
  applications,
  candidateProfiles,
  companies,
  jobMatches,
  jobs,
  type ApplicationRow,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { CandidatesService } from '../candidates/candidates.service.js';
import type {
  ApplicationDetailDto,
  ApplicationDto,
  CreateApplication,
  ListApplicationsQuery,
  TransitionRequest,
} from './applications.contract.js';
import { TRANSITIONS } from './engine.js';
import { createApplication, transition } from './lifecycle.js';

const toDto = (a: ApplicationRow, jobTitle: string, companyName: string): ApplicationDto => ({
  id: a.id,
  candidateProfileId: a.candidateProfileId,
  jobId: a.jobId,
  jobTitle,
  companyName,
  state: a.state,
  stateEnteredAt: a.stateEnteredAt.toISOString(),
  approvedBy: a.approvedBy,
  approvedAt: a.approvedAt?.toISOString() ?? null,
  appliedAt: a.appliedAt?.toISOString() ?? null,
  version: a.version,
});

@Injectable()
export class ApplicationsService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(CandidatesService) private readonly candidates: CandidatesService,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  /** Start an application by hand. The candidate is you, unless you manage candidates for others. */
  async create(p: Principal, input: CreateApplication): Promise<ApplicationDetailDto> {
    return this.tenant.inTenant(p, async (tx) => {
      let profileId = input.candidateProfileId;
      if (p.role === 'CANDIDATE' || !profileId) {
        const own = await this.candidates.ensureOwn(tx, p);
        if (profileId && profileId !== own.id)
          throw notFound(`Candidate ${profileId} does not exist`);
        profileId = own.id;
      } else {
        await this.candidates.visible(tx, p, profileId);
      }
      const [job] = await tx
        .select({ id: jobs.id, status: jobs.status })
        .from(jobs)
        .where(eq(jobs.id, input.jobId));
      if (!job) throw unprocessable('job-missing', 'Job does not exist', input.jobId);
      if (job.status !== 'ACTIVE') throw conflict('job-not-active', 'The job is no longer open');
      try {
        const created = await createApplication(tx, {
          organizationId: p.organizationId,
          candidateProfileId: profileId,
          jobId: input.jobId,
          actor: { type: 'USER', userId: p.userId },
        });
        await assertWithinQuota(tx, p.organizationId, 'applications', true);
        return this.detail(tx, p, created.id);
      } catch (e) {
        if (pgCode(e) === '23505') {
          throw conflict('application-exists', 'There is already an application for this job');
        }
        throw e;
      }
    });
  }

  async list(p: Principal, query: ListApplicationsQuery) {
    return this.tenant.inTenant(p, async (tx) => {
      const where: SQL[] = [];
      if (p.role === 'CANDIDATE') where.push(eq(candidateProfiles.userId, p.userId));
      if (query.state) where.push(eq(applications.state, query.state));
      if (query.candidateProfileId)
        where.push(eq(applications.candidateProfileId, query.candidateProfileId));
      if (query.jobId) where.push(eq(applications.jobId, query.jobId));
      const base = tx
        .select({ a: applications, title: jobs.title, company: companies.name })
        .from(applications)
        .innerJoin(candidateProfiles, eq(candidateProfiles.id, applications.candidateProfileId))
        .innerJoin(jobs, eq(jobs.id, applications.jobId))
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .where(and(...where));
      const [rows, totals] = await Promise.all([
        base
          .orderBy(desc(applications.stateEnteredAt), asc(applications.id))
          .limit(query.limit)
          .offset(query.offset),
        tx
          .select({ total: count() })
          .from(applications)
          .innerJoin(candidateProfiles, eq(candidateProfiles.id, applications.candidateProfileId))
          .where(and(...where)),
      ]);
      return toPage(
        rows.map((r) => toDto(r.a, r.title, r.company)),
        totals[0]?.total ?? 0,
        query,
      );
    });
  }

  async get(p: Principal, id: string): Promise<ApplicationDetailDto> {
    return this.tenant.inTenant(p, (tx) => this.detail(tx, p, id));
  }

  /** A person moves an application along. Approval has its own call, so it cannot be done by accident. */
  async move(p: Principal, id: string, input: TransitionRequest): Promise<ApplicationDetailDto> {
    if (input.to === 'APPROVED') {
      throw unprocessable(
        'use-approve',
        'Approval is its own action',
        'Call POST /applications/{id}/approve',
      );
    }
    return this.tenant.inTenant(p, async (tx) => {
      await this.mustSee(tx, p, id);
      await transition(tx, p.organizationId, id, input.to, {
        actor: { type: 'USER', userId: p.userId },
        eventType: `application.${input.to.toLowerCase()}`,
        payload: input.note ? { note: input.note } : {},
      });
      return this.detail(tx, p, id);
    });
  }

  /** Approve an application that is ready to apply. Only a person can, and it records who and when. */
  async approve(p: Principal, id: string, acknowledgeRisks = false): Promise<ApplicationDetailDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const app = await this.mustSee(tx, p, id);
      if (app.state !== 'READY_TO_APPLY' && app.state !== 'NEEDS_HUMAN_REVIEW') {
        throw new ProblemException(
          409,
          'not-ready-to-approve',
          'Only an application that is ready to apply can be approved',
          `This one is ${app.state}`,
        );
      }
      // The review the person was shown: a high-risk application needs them to say they have read the reasons.
      const review = await this.policy.evaluate(tx, app);
      if (review.requiresAcknowledgement && !acknowledgeRisks) {
        throw new ProblemException(
          409,
          'risk-acknowledgement-required',
          'Read the review before approving',
          review.reasons.map((r) => r.text).join(' '),
          { tier: review.tier, reasons: review.reasons },
        );
      }
      await transition(tx, p.organizationId, id, 'APPROVED', {
        actor: { type: 'USER', userId: p.userId },
        eventType: 'application.approved',
        payload: {
          policyTier: review.tier,
          ...(review.reasons.length
            ? { acknowledgedReasons: review.reasons.map((r) => r.text) }
            : {}),
        },
      });
      return this.detail(tx, p, id);
    });
  }

  // ---------- helpers ----------

  /** The application if this person may see it (a candidate sees only their own), else a plain 404. */
  async mustSee(tx: Tx, p: Principal, id: string): Promise<ApplicationRow> {
    const [row] = await tx
      .select({ a: applications, owner: candidateProfiles.userId })
      .from(applications)
      .innerJoin(candidateProfiles, eq(candidateProfiles.id, applications.candidateProfileId))
      .where(eq(applications.id, id));
    if (!row || (p.role === 'CANDIDATE' && row.owner !== p.userId)) {
      throw notFound(`Application ${id} does not exist`);
    }
    return row.a;
  }

  private async detail(tx: Tx, p: Principal, id: string): Promise<ApplicationDetailDto> {
    const app = await this.mustSee(tx, p, id);
    const [job] = await tx
      .select({ title: jobs.title, company: companies.name })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(jobs.id, app.jobId));
    const [match] = await tx
      .select()
      .from(jobMatches)
      .where(
        and(
          eq(jobMatches.candidateProfileId, app.candidateProfileId),
          eq(jobMatches.jobId, app.jobId),
        ),
      );
    const events = await tx
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, id))
      .orderBy(asc(applicationEvents.createdAt), sql`${applicationEvents.id}`);
    return {
      ...toDto(app, job?.title ?? '', job?.company ?? ''),
      allowedNext: [...TRANSITIONS[app.state]],
      match: match
        ? {
            overallScore: Number(match.overallScore),
            recommendation: match.recommendation,
            missingSkills: match.missingSkills,
          }
        : null,
      events: events.map((e) => ({
        fromState: e.fromState,
        toState: e.toState,
        actorType: e.actorType,
        actorId: e.actorId,
        eventType: e.eventType,
        payload: e.payload as Record<string, unknown>,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
