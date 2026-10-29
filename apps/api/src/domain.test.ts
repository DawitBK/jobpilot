import { describe, expect, it } from 'vitest';
import { TERMINAL_STATES, TRANSITIONS, validateTransition } from './applications/engine.js';
import { APPLICATION_STATES } from './db/schema.js';
import { isPrivateAddress, parseFeed } from './jobs/feeds.js';
import {
  dedupHashOf,
  extractRemoteType,
  extractSalary,
  extractSeniority,
  extractSkills,
  extractVisa,
  normalizePosting,
  toPlainText,
} from './jobs/normalize.js';
import { openApiDocument } from './openapi.js';
import {
  levelForYears,
  normalizeSkill,
  scoreJob,
  yearsOfExperience,
  type CandidateFacts,
  type JobFacts,
} from './matching/score.js';

const candidate = (over: Partial<CandidateFacts> = {}): CandidateFacts => ({
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  yearsExperience: 6,
  remotePref: 'FLEXIBLE',
  relocationOk: false,
  targetLocations: [],
  salaryMin: 90_000,
  salaryMax: 130_000,
  workAuthStatus: 'CITIZEN',
  ...over,
});
const job = (over: Partial<JobFacts> = {}): JobFacts => ({
  title: 'Backend Engineer',
  location: null,
  remoteType: 'REMOTE',
  requiredSkills: ['typescript', 'node', 'postgres'],
  preferredSkills: [],
  salaryMin: 100_000,
  salaryMax: 120_000,
  seniority: 'SENIOR',
  visaSponsorship: null,
  ...over,
});

describe('scoreJob', () => {
  it('gives a strong match a high score and an APPLY', () => {
    const r = scoreJob(candidate(), job());
    expect(r).toMatchObject({
      technicalScore: 100,
      locationScore: 100,
      salaryScore: 100,
      seniorityScore: 100,
    });
    expect(r.overallScore).toBe(100);
    expect(r.recommendation).toBe('APPLY');
    expect(r.missingSkills).toEqual([]);
  });

  it('treats different spellings of a skill as one', () => {
    expect(normalizeSkill(' JS ')).toBe('javascript');
    expect(normalizeSkill('Node')).toBe('node.js');
    expect(normalizeSkill('Postgres')).toBe('postgresql');
    expect(
      scoreJob(candidate({ skills: ['JS'] }), job({ requiredSkills: ['javascript'] }))
        .technicalScore,
    ).toBe(100);
  });

  it('lists what is missing and weighs required skills above preferred ones', () => {
    const r = scoreJob(
      candidate(),
      job({ requiredSkills: ['typescript', 'rust'], preferredSkills: ['postgresql'] }),
    );
    expect(r.missingSkills).toEqual(['rust']);
    expect(r.technicalScore).toBe(62.5); // 0.75 x 50% + 0.25 x 100%
    expect(r.strongEvidence).toEqual(expect.arrayContaining(['typescript', 'postgresql']));
  });

  it('is neutral about things the posting does not say', () => {
    const r = scoreJob(
      candidate(),
      job({ requiredSkills: [], salaryMin: null, salaryMax: null, seniority: null }),
    );
    expect(r.technicalScore).toBe(50);
    expect(r.salaryScore).toBe(70);
    expect(r.seniorityScore).toBe(70);
  });

  it('scores the work arrangement from what the candidate wants', () => {
    expect(
      scoreJob(candidate({ remotePref: 'REMOTE_ONLY' }), job({ remoteType: 'HYBRID' }))
        .locationScore,
    ).toBe(40);
    expect(
      scoreJob(candidate({ remotePref: 'ONSITE' }), job({ remoteType: 'REMOTE' })).locationScore,
    ).toBe(70);
    expect(
      scoreJob(candidate({ remotePref: 'FLEXIBLE' }), job({ remoteType: 'ONSITE' })).locationScore,
    ).toBe(100);
  });

  it('caps the location score for a job in the wrong place unless the candidate will relocate', () => {
    const wrong = job({ remoteType: 'HYBRID', location: 'Oslo' });
    expect(scoreJob(candidate({ targetLocations: ['Nairobi'] }), wrong).locationScore).toBe(20);
    expect(
      scoreJob(candidate({ targetLocations: ['Nairobi'], relocationOk: true }), wrong)
        .locationScore,
    ).toBe(60);
    expect(scoreJob(candidate({ targetLocations: ['oslo'] }), wrong).locationScore).toBe(100);
  });

  it('scores salary by how far the job reaches into what the candidate needs', () => {
    expect(scoreJob(candidate(), job({ salaryMin: 50_000, salaryMax: 80_000 })).salaryScore).toBe(
      0,
    );
    expect(scoreJob(candidate(), job({ salaryMin: 70_000, salaryMax: 110_000 })).salaryScore).toBe(
      50,
    );
    expect(scoreJob(candidate(), job({ salaryMin: 95_000, salaryMax: 200_000 })).salaryScore).toBe(
      100,
    );
  });

  it('scores seniority by distance from the level the experience suggests', () => {
    expect(levelForYears(1)).toBe(0);
    expect(levelForYears(6)).toBe(2);
    expect(levelForYears(15)).toBe(4);
    expect(
      scoreJob(candidate({ yearsExperience: 6 }), job({ seniority: 'MID' })).seniorityScore,
    ).toBe(70);
    expect(
      scoreJob(candidate({ yearsExperience: 6 }), job({ seniority: 'PRINCIPAL' })).seniorityScore,
    ).toBe(35);
    expect(
      scoreJob(candidate({ yearsExperience: 1 }), job({ seniority: 'PRINCIPAL' })).seniorityScore,
    ).toBe(0);
  });

  it('forces SKIP on a hard filter, however good the rest is', () => {
    const visa = scoreJob(
      candidate({ workAuthStatus: 'NEEDS_SPONSORSHIP' }),
      job({ visaSponsorship: false }),
    );
    expect(visa.technicalScore).toBe(100);
    expect(visa).toMatchObject({
      recommendation: 'SKIP',
      hardFilters: ['visa-sponsorship-not-offered'],
    });
    const onsite = scoreJob(
      candidate({ targetLocations: ['Nairobi'] }),
      job({ remoteType: 'ONSITE', location: 'Oslo' }),
    );
    expect(onsite.hardFilters).toContain('onsite-outside-target-locations');
    expect(onsite.recommendation).toBe('SKIP');
    expect(
      scoreJob(candidate({ remotePref: 'REMOTE_ONLY' }), job({ remoteType: 'ONSITE' })).hardFilters,
    ).toContain('onsite-but-remote-only');
  });

  it('is deterministic and bounded', () => {
    const a = scoreJob(candidate(), job({ requiredSkills: ['x'] }));
    expect(scoreJob(candidate(), job({ requiredSkills: ['x'] }))).toEqual(a);
    for (const v of [
      a.overallScore,
      a.technicalScore,
      a.locationScore,
      a.salaryScore,
      a.seniorityScore,
    ]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });
});

describe('yearsOfExperience', () => {
  it('counts overlapping roles once and ignores nonsense', () => {
    const years = yearsOfExperience(
      [
        { startDate: '2018-01-01', endDate: '2022-01-01' },
        { startDate: '2020-01-01', endDate: '2023-01-01' },
        { startDate: '2030-01-01', endDate: '2029-01-01' },
      ],
      new Date('2026-01-01'),
    );
    expect(years).toBe(5);
    expect(
      yearsOfExperience([{ startDate: '2024-01-01', endDate: null }], new Date('2026-07-01')),
    ).toBe(2);
    expect(yearsOfExperience([])).toBe(0);
  });
});

describe('the application state machine', () => {
  it('has a way to every state, and terminal states lead nowhere', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...APPLICATION_STATES].sort());
    expect([...TERMINAL_STATES].sort()).toEqual([
      'ACCEPTED',
      'EXPIRED',
      'NO_RESPONSE',
      'REJECTED',
      'WITHDRAWN',
    ]);
    const reachable = new Set<string>(['DISCOVERED']);
    for (let i = 0; i < APPLICATION_STATES.length; i += 1) {
      for (const s of [...reachable])
        for (const t of TRANSITIONS[s as keyof typeof TRANSITIONS]) reachable.add(t);
    }
    expect([...reachable].sort()).toEqual([...APPLICATION_STATES].sort());
  });

  it('only ever reaches APPROVED from a person, and only from the states that allow it', () => {
    const into = APPLICATION_STATES.filter((s) => TRANSITIONS[s].includes('APPROVED'));
    expect(into.sort()).toEqual(['NEEDS_HUMAN_REVIEW', 'READY_TO_APPLY']);
    expect(() => validateTransition('SHORTLISTED', 'APPROVED', 'USER')).toThrow(/can go to/);
  });
});

describe('posting normalisation', () => {
  it('reads salary, seniority, remote and visa from the words people use', () => {
    expect(extractSalary('Pay: $120,000 - $150,000 a year')).toEqual({ min: 120000, max: 150000 });
    expect(extractSalary('80k–100k')).toEqual({ min: 80000, max: 100000 });
    expect(extractSalary('ETB 80,000 to 100,000')).toEqual({ min: 80000, max: 100000 });
    expect(extractSalary('competitive')).toEqual({ min: null, max: null });
    expect(extractSeniority('Senior Backend Engineer')).toBe('SENIOR');
    expect(extractSeniority('Staff Engineer')).toBe('STAFF');
    expect(extractSeniority('Junior Developer')).toBe('ENTRY');
    expect(extractSeniority('Engineer')).toBeNull();
    expect(extractRemoteType('Engineer (Remote)', null, '')).toBe('REMOTE');
    expect(extractRemoteType('Engineer', 'Addis Ababa', 'Hybrid, three days in the office')).toBe(
      'HYBRID',
    );
    expect(extractRemoteType('Engineer', null, 'This role is remote.')).toBe('REMOTE');
    expect(extractRemoteType('Engineer', null, 'Remote is not possible, on-site only')).toBe(
      'ONSITE',
    );
    expect(extractVisa('We cannot offer visa sponsorship')).toBe(false);
    expect(extractVisa('Visa sponsorship is available')).toBe(true);
    expect(extractVisa('Great team')).toBeNull();
  });

  it('finds skills without being fooled by ordinary words', () => {
    const skills = extractSkills(
      'We use TypeScript, Node, k8s and Postgres. Go to market fast. Express your interest.',
    );
    expect(skills).toEqual(
      expect.arrayContaining(['typescript', 'node.js', 'kubernetes', 'postgresql']),
    );
    expect(skills).not.toContain('go');
    expect(skills).not.toContain('express');
    expect(extractSkills('Java and JavaScript')).toEqual(
      expect.arrayContaining(['java', 'javascript']),
    );
    expect(extractSkills('Go (golang) and C++')).toEqual(expect.arrayContaining(['go', 'c++']));
  });

  it('strips HTML, including HTML that arrives escaped', () => {
    expect(toPlainText('<p>Hello <b>world</b></p><script>bad()</script>')).toBe('Hello world');
    expect(toPlainText('&lt;p&gt;Escaped &amp;amp; fine&lt;/p&gt;')).toContain('Escaped');
    expect(toPlainText('&lt;p&gt;Escaped&lt;/p&gt;')).not.toContain('<');
  });

  it('gives the same posting the same identity from any source', () => {
    expect(dedupHashOf('Acme Corp', 'Backend Engineer', 'Addis Ababa')).toBe(
      dedupHashOf('ACME  corp!', 'backend engineer', 'addis ababa'),
    );
    expect(dedupHashOf('Acme', 'Backend Engineer', 'Addis')).not.toBe(
      dedupHashOf('Acme', 'Backend Engineer', 'Nairobi'),
    );
    const n = normalizePosting({
      externalId: '1',
      title: ' Backend Engineer ',
      company: ' Acme ',
      location: 'Addis',
      description: '<p>TypeScript. Nice to have: Docker.</p>',
      url: 'javascript:alert(1)',
      postedAt: null,
    });
    expect(n.requiredSkills).toEqual(['typescript']);
    expect(n.preferredSkills).toEqual(['docker']);
    expect(n.applicationUrl).toBeNull(); // a non-http link is never kept
  });
});

describe('feeds', () => {
  it('parses RSS and Atom', () => {
    const rss = parseFeed(
      '<rss><channel><item><title>Dev at Foo</title><link>https://a.test/1</link><guid>g1</guid><pubDate>Mon, 01 Jan 2026 10:00:00 GMT</pubDate><description>Text</description></item></channel></rss>',
      'Fallback',
    );
    expect(rss).toEqual([
      expect.objectContaining({
        externalId: 'g1',
        title: 'Dev',
        company: 'Foo',
        url: 'https://a.test/1',
        description: 'Text',
      }),
    ]);
    expect(rss[0]!.postedAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    const atom = parseFeed(
      '<feed><entry><title>Designer</title><link href="https://a.test/2"/><id>e2</id><summary>S</summary></entry></feed>',
      'Fallback Co',
    );
    expect(atom[0]).toMatchObject({
      title: 'Designer',
      company: 'Fallback Co',
      url: 'https://a.test/2',
    });
    expect(parseFeed('<rss><channel></channel></rss>', 'x')).toEqual([]);
  });

  it('recognises addresses a feed URL must never reach', () => {
    for (const bad of [
      '127.0.0.1',
      '10.1.2.3',
      '192.168.0.9',
      '172.16.5.5',
      '169.254.169.254',
      '0.0.0.0',
      '100.64.1.1',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
    ]) {
      expect(isPrivateAddress(bad), bad).toBe(true);
    }
    for (const ok of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700::1111']) {
      expect(isPrivateAddress(ok), ok).toBe(false);
    }
  });
});

describe('OpenAPI document', () => {
  const doc = openApiDocument() as {
    paths: Record<string, Record<string, { operationId: string; security?: unknown }>>;
  };
  const operations = Object.values(doc.paths).flatMap((m) => Object.values(m));

  it('has a unique operation id per route', () => {
    const ids = operations.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(37);
  });

  it('marks every non-public route as needing a bearer token', () => {
    const open = new Set([
      'register',
      'login',
      'loginMfa',
      'selectOrganization',
      'refresh',
      'logout',
    ]);
    for (const op of operations) {
      expect(op.security !== undefined, op.operationId).toBe(!open.has(op.operationId));
    }
  });
});
