import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../db/db.module.js';
import {
  applicationDocuments,
  candidateProfiles,
  jobMatches,
  jobs,
  organizations,
  type ApplicationRow,
} from '../db/schema.js';
import { evaluatePolicy, resolvePolicy, type PolicyInput, type PolicyResult } from './policy.js';

/** Gathers what the policy needs to know about one application. */
@Injectable()
export class PolicyService {
  async settingsOf(tx: Tx, organizationId: string) {
    const [org] = await tx
      .select({ policy: organizations.policy })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    return resolvePolicy(org?.policy);
  }

  /** The latest version of each kind of document, newest first. */
  async latestDocuments(tx: Tx, applicationId: string) {
    const rows = await tx
      .select()
      .from(applicationDocuments)
      .where(eq(applicationDocuments.applicationId, applicationId))
      .orderBy(desc(applicationDocuments.version), desc(applicationDocuments.createdAt));
    const seen = new Set<string>();
    return rows.filter((d) => (seen.has(d.kind) ? false : (seen.add(d.kind), true)));
  }

  async evaluate(tx: Tx, app: ApplicationRow): Promise<PolicyResult> {
    const [job] = await tx.select().from(jobs).where(eq(jobs.id, app.jobId));
    const [profile] = await tx
      .select({ salaryMin: candidateProfiles.salaryMin })
      .from(candidateProfiles)
      .where(eq(candidateProfiles.id, app.candidateProfileId));
    const [match] = await tx
      .select()
      .from(jobMatches)
      .where(
        and(
          eq(jobMatches.candidateProfileId, app.candidateProfileId),
          eq(jobMatches.jobId, app.jobId),
        ),
      );
    const docs = await this.latestDocuments(tx, app.id);
    const verdicts: Record<string, number> = {};
    for (const d of docs)
      for (const [k, v] of Object.entries(d.verdicts)) verdicts[k] = (verdicts[k] ?? 0) + v;
    const input: PolicyInput = {
      match: match
        ? {
            overallScore: Number(match.overallScore),
            recommendation: match.recommendation,
            hardFilters: match.hardFilters,
            missingSkills: match.missingSkills,
          }
        : null,
      candidateSalaryMin: profile?.salaryMin ?? null,
      jobSalaryMax: job?.salaryMax ?? null,
      documentVerdicts: verdicts,
      documentsNeedReview: docs.some((d) => d.needsReview),
      jobIsOpen: job?.status === 'ACTIVE',
    };
    return evaluatePolicy(input, await this.settingsOf(tx, app.organizationId));
  }
}
