import { z } from 'zod';

/**
 * The review policy: how much a person must look at before an application goes on. It never lets
 * anything but a person approve (ADR 0002): `autoSubmitAllowed` is a constant false, kept in the
 * result so a future automated sender has one obvious thing to check, and the tests pin it.
 */
export const policySettingsSchema = z
  .object({
    /** Applying below this score needs a second look. */
    minScoreForApproval: z.number().int().min(0).max(100).default(60),
    /** Pay this far below the candidate's minimum (percent) needs a second look. */
    salaryGapPercent: z.number().int().min(0).max(100).default(25),
    /** Missing more than this many required skills needs a second look. */
    maxMissingSkills: z.number().int().min(0).max(30).default(3),
  })
  .strict();
export type PolicySettings = z.output<typeof policySettingsSchema>;

export const DEFAULT_POLICY: PolicySettings = policySettingsSchema.parse({});

/** Stored policy may be missing or partial (an organization that never set one): fill the gaps with the defaults. */
export function resolvePolicy(stored: unknown): PolicySettings {
  const parsed = policySettingsSchema.partial().safeParse(stored ?? {});
  return { ...DEFAULT_POLICY, ...(parsed.success ? parsed.data : {}) };
}

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH';

export interface PolicyInput {
  match: {
    overallScore: number;
    recommendation: 'APPLY' | 'MAYBE' | 'SKIP';
    hardFilters: string[];
    missingSkills: string[];
  } | null;
  candidateSalaryMin: number | null;
  jobSalaryMax: number | null;
  /** Verdict counts of the latest generated documents (UNSUPPORTED, CONFLICTING, ...). */
  documentVerdicts: Record<string, number>;
  documentsNeedReview: boolean;
  jobIsOpen: boolean;
}

export interface PolicyResult {
  tier: RiskTier;
  reasons: { tier: RiskTier; text: string }[];
  /** HIGH means the person must acknowledge the reasons when they approve. */
  requiresAcknowledgement: boolean;
  autoSubmitAllowed: false;
  autoSubmitNote: string;
}

const AUTO_SUBMIT_NOTE =
  'Only a person can approve an application. Nothing is sent to an employer by JobPilot itself.';

export function evaluatePolicy(
  input: PolicyInput,
  settings: PolicySettings = DEFAULT_POLICY,
): PolicyResult {
  const reasons: PolicyResult['reasons'] = [];
  const add = (tier: RiskTier, text: string) => reasons.push({ tier, text });

  if (!input.jobIsOpen) add('HIGH', 'The job is no longer open.');
  if (input.match) {
    if (input.match.hardFilters.length > 0) {
      add('HIGH', `A hard requirement is not met: ${input.match.hardFilters.join('; ')}.`);
    }
    if (input.match.recommendation === 'SKIP' && input.match.hardFilters.length === 0) {
      add('HIGH', `The match score (${input.match.overallScore}) is a SKIP.`);
    } else if (input.match.overallScore < settings.minScoreForApproval) {
      add(
        'MEDIUM',
        `The match score (${input.match.overallScore}) is below your threshold of ${settings.minScoreForApproval}.`,
      );
    } else if (input.match.recommendation === 'MAYBE') {
      add('MEDIUM', 'The match is a maybe, not a clear fit.');
    }
    if (input.match.missingSkills.length > settings.maxMissingSkills) {
      add(
        'MEDIUM',
        `${input.match.missingSkills.length} required skills are missing (${input.match.missingSkills.slice(0, 5).join(', ')}).`,
      );
    }
  } else {
    add('MEDIUM', 'There is no match score for this application.');
  }
  if (
    input.candidateSalaryMin !== null &&
    input.jobSalaryMax !== null &&
    input.candidateSalaryMin > 0
  ) {
    const gap = ((input.candidateSalaryMin - input.jobSalaryMax) / input.candidateSalaryMin) * 100;
    if (gap > settings.salaryGapPercent) {
      add(
        'MEDIUM',
        `The top of the pay range is ${Math.round(gap)}% below the candidate's minimum.`,
      );
    }
  }
  const bad =
    (input.documentVerdicts['UNSUPPORTED'] ?? 0) + (input.documentVerdicts['CONFLICTING'] ?? 0);
  if (bad > 0) {
    add(
      'HIGH',
      `${bad} statement${bad === 1 ? '' : 's'} in the generated documents are not backed by the candidate's record.`,
    );
  } else if (input.documentsNeedReview) {
    add('HIGH', 'The generated documents were stopped for review.');
  }

  const tier: RiskTier = reasons.some((r) => r.tier === 'HIGH')
    ? 'HIGH'
    : reasons.some((r) => r.tier === 'MEDIUM')
      ? 'MEDIUM'
      : 'LOW';
  return {
    tier,
    reasons,
    requiresAcknowledgement: tier === 'HIGH',
    autoSubmitAllowed: false,
    autoSubmitNote: AUTO_SUBMIT_NOTE,
  };
}
