import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, evaluatePolicy, resolvePolicy, type PolicyInput } from './policy.js';

const base: PolicyInput = {
  match: { overallScore: 90, recommendation: 'APPLY', hardFilters: [], missingSkills: [] },
  candidateSalaryMin: 80000,
  jobSalaryMax: 100000,
  documentVerdicts: { SUPPORTED: 6 },
  documentsNeedReview: false,
  jobIsOpen: true,
};

describe('review policy', () => {
  it('is low risk for a clear, open, well-evidenced match', () => {
    const r = evaluatePolicy(base);
    expect(r.tier).toBe('LOW');
    expect(r.reasons).toEqual([]);
    expect(r.requiresAcknowledgement).toBe(false);
  });

  it('never allows an automatic submission, whatever the tier', () => {
    for (const input of [base, { ...base, jobIsOpen: false }, { ...base, match: null }]) {
      expect(evaluatePolicy(input).autoSubmitAllowed).toBe(false);
    }
    expect(evaluatePolicy(base).autoSubmitNote).toMatch(/only a person/i);
  });

  it('is high risk when a hard requirement is not met, and says which', () => {
    const r = evaluatePolicy({
      ...base,
      match: {
        overallScore: 95,
        recommendation: 'SKIP',
        hardFilters: ['needs visa sponsorship'],
        missingSkills: [],
      },
    });
    expect(r.tier).toBe('HIGH');
    expect(r.requiresAcknowledgement).toBe(true);
    expect(r.reasons[0]!.text).toContain('needs visa sponsorship');
  });

  it('is high risk for unsupported or conflicting claims, and for documents stopped for review', () => {
    expect(
      evaluatePolicy({ ...base, documentVerdicts: { SUPPORTED: 3, UNSUPPORTED: 1 } }).tier,
    ).toBe('HIGH');
    expect(
      evaluatePolicy({ ...base, documentVerdicts: { CONFLICTING: 2 } }).reasons[0]!.text,
    ).toContain('2 statements');
    expect(evaluatePolicy({ ...base, documentsNeedReview: true }).tier).toBe('HIGH');
    // UNKNOWN (subjective, nothing to check) does not raise the tier by itself.
    expect(evaluatePolicy({ ...base, documentVerdicts: { SUPPORTED: 2, UNKNOWN: 4 } }).tier).toBe(
      'LOW',
    );
  });

  it('is high risk for a closed job', () => {
    expect(evaluatePolicy({ ...base, jobIsOpen: false }).tier).toBe('HIGH');
  });

  it('is medium for a maybe, a low score, many missing skills, or pay well under the minimum', () => {
    expect(
      evaluatePolicy({
        ...base,
        match: { ...base.match!, overallScore: 70, recommendation: 'MAYBE' },
      }).tier,
    ).toBe('MEDIUM');
    expect(
      evaluatePolicy({
        ...base,
        match: { ...base.match!, overallScore: 55, recommendation: 'MAYBE' },
      }).reasons[0]!.text,
    ).toContain('below your threshold');
    expect(
      evaluatePolicy({ ...base, match: { ...base.match!, missingSkills: ['a', 'b', 'c', 'd'] } })
        .tier,
    ).toBe('MEDIUM');
    expect(evaluatePolicy({ ...base, jobSalaryMax: 55000 }).reasons[0]!.text).toContain(
      '31% below',
    );
    expect(evaluatePolicy({ ...base, match: null }).tier).toBe('MEDIUM');
  });

  it('honours an organization that sets stricter or looser rules', () => {
    const strict = resolvePolicy({ minScoreForApproval: 95, maxMissingSkills: 0 });
    expect(evaluatePolicy(base, strict).tier).toBe('MEDIUM');
    const loose = resolvePolicy({ salaryGapPercent: 90 });
    expect(evaluatePolicy({ ...base, jobSalaryMax: 30000 }, loose).tier).toBe('LOW');
  });

  it('falls back to the defaults for stored settings that are missing or malformed', () => {
    expect(resolvePolicy(undefined)).toEqual(DEFAULT_POLICY);
    expect(resolvePolicy({})).toEqual(DEFAULT_POLICY);
    expect(resolvePolicy({ minScoreForApproval: 'high' })).toEqual(DEFAULT_POLICY);
    expect(resolvePolicy({ minScoreForApproval: 70 }).minScoreForApproval).toBe(70);
  });
});
