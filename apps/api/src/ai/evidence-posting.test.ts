import { describe, expect, it } from 'vitest';
import { buildFacts, verifyClaims, type CandidateRecord } from './evidence.js';

const lena: CandidateRecord = {
  fullName: 'Lena Live',
  headline: 'Backend engineer',
  summary: 'Five years building APIs.',
  yearsExperience: 5,
  skills: [{ skillName: 'typescript', proficiency: 'ADVANCED', yearsExperience: 5 }],
  experience: [
    {
      companyName: 'Tailspin Logistics',
      title: 'Backend Engineer',
      startDate: '2020-02-01',
      endDate: null,
      description: 'Built the shipment-tracking API.',
      technologies: ['typescript'],
    },
  ],
  education: [],
  projects: [],
};
const facts = buildFacts(lena);
const posting = ['Northwind Cloud', 'Senior Backend Engineer'];
const verdict = (text: string, names: string[] = posting) =>
  verifyClaims([{ text, citedFactIds: [] }], facts, lena, names)[0]!;

describe('names that come from the job posting', () => {
  it('may be addressed: a letter to the employer names the employer', () => {
    // Found by running a real model: this sentence was wrongly stopped for review.
    expect(
      verdict('I look forward to contributing my backend expertise to Northwind Cloud.').verdict,
    ).not.toBe('UNSUPPORTED');
    expect(
      verdict('I am applying for the Senior Backend Engineer role at Northwind Cloud.').verdict,
    ).not.toBe('UNSUPPORTED');
    expect(
      verdict('Dear hiring team at Northwind Cloud, I use TypeScript every day.').verdict,
    ).toBe('SUPPORTED');
  });

  it("may never be passed off as the candidate's own past", () => {
    for (const lie of [
      'I worked at Northwind Cloud for three years.',
      'At Northwind Cloud I built the billing platform.',
      'My time at Northwind Cloud taught me a lot.',
      'Previously employed by Northwind Cloud as an engineer.',
      'While working for Northwind Cloud I shipped TypeScript services.',
    ]) {
      const c = verdict(lie);
      expect(c.verdict, lie).toBe('UNSUPPORTED');
      expect(c.detail).toContain('Northwind Cloud');
    }
  });

  it('does not excuse a name the posting never mentioned', () => {
    expect(verdict('I look forward to contributing to Globex.').verdict).toBe('UNSUPPORTED');
    expect(verdict('I look forward to contributing to Northwind Cloud.', []).verdict).toBe(
      'UNSUPPORTED',
    );
  });

  it("still accepts the candidate's real employer, with or without the posting", () => {
    expect(verdict('At Tailspin Logistics I built the shipment-tracking API.').verdict).toBe(
      'SUPPORTED',
    );
  });
});
