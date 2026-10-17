import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { createApplication } from '../applications/lifecycle.js';
import type { Tx } from '../db/db.module.js';
import {
  applications,
  candidateExperience,
  candidateProfiles,
  candidateSkills,
  jobMatches,
  jobs,
  type CandidateProfileRow,
  type JobRow,
} from '../db/schema.js';
import {
  SCORING_VERSION,
  scoreJob,
  yearsOfExperience,
  type CandidateFacts,
  type JobFacts,
  type MatchResult,
} from './score.js';

export const jobFacts = (j: JobRow): JobFacts => ({
  title: j.title,
  location: j.location,
  remoteType: j.remoteType,
  requiredSkills: j.requiredSkills,
  preferredSkills: j.preferredSkills,
  salaryMin: j.salaryMin,
  salaryMax: j.salaryMax,
  seniority: j.seniority,
  visaSponsorship: j.visaSponsorship,
});

const n2 = (n: number) => n.toFixed(2);

/** Scores jobs against candidates and keeps the results; a worthwhile match opens an application. */
@Injectable()
export class MatchingService {
  /** What the scorer needs to know about each candidate profile in an organization. */
  async candidateFacts(
    tx: Tx,
    organizationId: string,
    profileIds?: string[],
  ): Promise<{ profile: CandidateProfileRow; facts: CandidateFacts }[]> {
    const profiles = await tx
      .select()
      .from(candidateProfiles)
      .where(
        profileIds
          ? and(
              eq(candidateProfiles.organizationId, organizationId),
              inArray(candidateProfiles.id, profileIds),
            )
          : eq(candidateProfiles.organizationId, organizationId),
      );
    if (profiles.length === 0) return [];
    const ids = profiles.map((p) => p.id);
    const [skills, experience] = await Promise.all([
      tx.select().from(candidateSkills).where(inArray(candidateSkills.candidateProfileId, ids)),
      tx
        .select()
        .from(candidateExperience)
        .where(inArray(candidateExperience.candidateProfileId, ids)),
    ]);
    return profiles.map((profile) => ({
      profile,
      facts: {
        skills: skills.filter((s) => s.candidateProfileId === profile.id).map((s) => s.skillName),
        yearsExperience: yearsOfExperience(
          experience.filter((e) => e.candidateProfileId === profile.id),
        ),
        remotePref: profile.remotePref,
        relocationOk: profile.relocationOk,
        targetLocations: profile.targetLocations,
        salaryMin: profile.salaryMin,
        salaryMax: profile.salaryMax,
        workAuthStatus: profile.workAuthStatus,
      },
    }));
  }

  /** Score every job given against every candidate given; returns how many matches were written. */
  async scoreJobs(
    tx: Tx,
    organizationId: string,
    jobRows: JobRow[],
    profileIds?: string[],
  ): Promise<number> {
    const candidates = await this.candidateFacts(tx, organizationId, profileIds);
    let written = 0;
    for (const job of jobRows) {
      for (const { profile, facts } of candidates) {
        const result = scoreJob(facts, jobFacts(job));
        await this.save(tx, organizationId, profile.id, job.id, result);
        written += 1;
        // A match worth acting on becomes an application, once; a SKIP does not.
        if (result.recommendation !== 'SKIP') {
          const [existing] = await tx
            .select({ id: applications.id })
            .from(applications)
            .where(
              and(eq(applications.candidateProfileId, profile.id), eq(applications.jobId, job.id)),
            );
          if (!existing && job.status === 'ACTIVE') {
            await createApplication(tx, {
              organizationId,
              candidateProfileId: profile.id,
              jobId: job.id,
              actor: { type: 'SYSTEM', userId: null },
              payload: { score: result.overallScore, recommendation: result.recommendation },
            });
          }
        }
      }
    }
    return written;
  }

  async rescoreCandidate(tx: Tx, organizationId: string, profileId: string): Promise<number> {
    const active = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.organizationId, organizationId), eq(jobs.status, 'ACTIVE')));
    return this.scoreJobs(tx, organizationId, active, [profileId]);
  }

  private async save(
    tx: Tx,
    organizationId: string,
    candidateProfileId: string,
    jobId: string,
    r: MatchResult,
  ): Promise<void> {
    const values = {
      organizationId,
      candidateProfileId,
      jobId,
      overallScore: n2(r.overallScore),
      technicalScore: n2(r.technicalScore),
      locationScore: n2(r.locationScore),
      salaryScore: n2(r.salaryScore),
      seniorityScore: n2(r.seniorityScore),
      missingSkills: r.missingSkills,
      strongEvidence: r.strongEvidence,
      hardFilters: r.hardFilters,
      recommendation: r.recommendation,
      scoringVersion: SCORING_VERSION,
    };
    await tx
      .insert(jobMatches)
      .values(values)
      .onConflictDoUpdate({
        target: [jobMatches.candidateProfileId, jobMatches.jobId],
        set: { ...values, updatedAt: sql`now()` },
      });
  }
}
