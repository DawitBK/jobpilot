/**
 * The rules-based matching engine: a pure function, so every score is reproducible and testable.
 * Hard filters decide first and nothing downstream (a later AI layer included) can override them.
 */

export const SCORING_VERSION = 'rules-1';

export type WorkAuth =
  'CITIZEN' | 'PERMANENT_RESIDENT' | 'VISA_HOLDER' | 'NEEDS_SPONSORSHIP' | 'OTHER';
export type RemotePref = 'REMOTE_ONLY' | 'HYBRID' | 'ONSITE' | 'FLEXIBLE';
export type RemoteType = 'REMOTE' | 'HYBRID' | 'ONSITE';
export type Seniority = 'ENTRY' | 'MID' | 'SENIOR' | 'STAFF' | 'PRINCIPAL';

export interface CandidateFacts {
  skills: string[];
  /** Whole years of professional experience, worked out from the career history. */
  yearsExperience: number;
  remotePref: RemotePref;
  relocationOk: boolean;
  targetLocations: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  workAuthStatus: WorkAuth;
}

export interface JobFacts {
  title: string;
  location: string | null;
  remoteType: RemoteType;
  requiredSkills: string[];
  preferredSkills: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: Seniority | null;
  visaSponsorship: boolean | null;
}

export interface MatchResult {
  overallScore: number;
  technicalScore: number;
  locationScore: number;
  salaryScore: number;
  seniorityScore: number;
  missingSkills: string[];
  strongEvidence: string[];
  hardFilters: string[];
  recommendation: 'APPLY' | 'MAYBE' | 'SKIP';
}

/** The same skill written differently should count once ("JS", "Javascript", "node" and "Node.js"). */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  node: 'node.js',
  nodejs: 'node.js',
  'node js': 'node.js',
  postgres: 'postgresql',
  psql: 'postgresql',
  k8s: 'kubernetes',
  reactjs: 'react',
  'react.js': 'react',
  nextjs: 'next.js',
  'next js': 'next.js',
  golang: 'go',
  py: 'python',
  'c#': 'csharp',
  dotnet: '.net',
  aws: 'amazon web services',
  gcp: 'google cloud',
};

export const normalizeSkill = (s: string): string => {
  const k = s.trim().toLowerCase().replace(/\s+/g, ' ');
  return ALIASES[k] ?? k;
};

const LEVEL: Record<Seniority, number> = { ENTRY: 0, MID: 1, SENIOR: 2, STAFF: 3, PRINCIPAL: 4 };

/** The level a candidate's years of experience suggests. */
export function levelForYears(years: number): number {
  if (years < 2) return 0;
  if (years < 5) return 1;
  if (years < 8) return 2;
  if (years < 12) return 3;
  return 4;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** How well the work arrangement suits what the candidate wants (candidate preference x job type). */
const ARRANGEMENT: Record<RemotePref, Record<RemoteType, number>> = {
  REMOTE_ONLY: { REMOTE: 100, HYBRID: 40, ONSITE: 0 },
  HYBRID: { REMOTE: 90, HYBRID: 100, ONSITE: 60 },
  ONSITE: { REMOTE: 70, HYBRID: 80, ONSITE: 100 },
  FLEXIBLE: { REMOTE: 100, HYBRID: 100, ONSITE: 100 },
};

function locationMatches(job: JobFacts, c: CandidateFacts): boolean {
  if (!job.location || c.targetLocations.length === 0) return true; // nothing to contradict
  const where = job.location.toLowerCase();
  return c.targetLocations.some((t) => where.includes(t.trim().toLowerCase()));
}

export function scoreJob(c: CandidateFacts, job: JobFacts): MatchResult {
  const have = new Set(c.skills.map(normalizeSkill));
  const required = [...new Set(job.requiredSkills.map(normalizeSkill))];
  const preferred = [...new Set(job.preferredSkills.map(normalizeSkill))].filter(
    (s) => !required.includes(s),
  );

  const share = (list: string[]) =>
    list.length === 0 ? null : list.filter((s) => have.has(s)).length / list.length;
  const reqShare = share(required);
  const prefShare = share(preferred);
  let technical: number;
  if (reqShare !== null && prefShare !== null)
    technical = 100 * (0.75 * reqShare + 0.25 * prefShare);
  else if (reqShare !== null) technical = 100 * reqShare;
  else if (prefShare !== null) technical = 100 * prefShare;
  else technical = 50; // the job names no skills, so there is nothing to say either way

  const missingSkills = required.filter((s) => !have.has(s));
  const strongEvidence = [...required, ...preferred].filter((s) => have.has(s)).slice(0, 10);

  const sitsAtLocation = locationMatches(job, c);
  let location = ARRANGEMENT[c.remotePref][job.remoteType];
  if (job.remoteType !== 'REMOTE' && !sitsAtLocation) {
    location = Math.min(location, c.relocationOk ? 60 : 20);
  }

  let salary = 70; // a missing figure on either side is neutral
  if (job.salaryMax !== null && c.salaryMin !== null) {
    if (job.salaryMax < c.salaryMin) salary = 0;
    else if (job.salaryMin !== null && job.salaryMin >= c.salaryMin) salary = 100;
    else if (job.salaryMin !== null && job.salaryMax > job.salaryMin) {
      salary = (100 * (job.salaryMax - c.salaryMin)) / (job.salaryMax - job.salaryMin);
    } else salary = 100;
  }

  let seniority = 70;
  if (job.seniority) {
    const gap = Math.abs(LEVEL[job.seniority] - levelForYears(c.yearsExperience));
    seniority = gap === 0 ? 100 : gap === 1 ? 70 : gap === 2 ? 35 : 0;
  }

  // Hard filters: a posting the candidate cannot take is a SKIP whatever else it scores.
  const hardFilters: string[] = [];
  if (c.workAuthStatus === 'NEEDS_SPONSORSHIP' && job.visaSponsorship === false) {
    hardFilters.push('visa-sponsorship-not-offered');
  }
  if (job.remoteType === 'ONSITE' && !c.relocationOk && !sitsAtLocation) {
    hardFilters.push('onsite-outside-target-locations');
  }
  if (c.remotePref === 'REMOTE_ONLY' && job.remoteType === 'ONSITE') {
    hardFilters.push('onsite-but-remote-only');
  }

  const overall = technical * 0.45 + location * 0.2 + seniority * 0.2 + salary * 0.15;
  const overallScore = round2(clamp(overall));
  const recommendation =
    hardFilters.length > 0
      ? 'SKIP'
      : overallScore >= 80
        ? 'APPLY'
        : overallScore >= 60
          ? 'MAYBE'
          : 'SKIP';
  return {
    overallScore,
    technicalScore: round2(clamp(technical)),
    locationScore: round2(clamp(location)),
    salaryScore: round2(clamp(salary)),
    seniorityScore: round2(clamp(seniority)),
    missingSkills,
    strongEvidence,
    hardFilters,
    recommendation,
  };
}

/** Whole years of experience from a career history (overlapping roles are not counted twice). */
export function yearsOfExperience(
  roles: { startDate: string; endDate: string | null }[],
  today: Date = new Date(),
): number {
  const spans = roles
    .map(
      (r) =>
        [Date.parse(r.startDate), r.endDate ? Date.parse(r.endDate) : today.getTime()] as const,
    )
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b >= a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let currentStart = 0;
  let currentEnd = -Infinity;
  for (const [start, end] of spans) {
    if (start > currentEnd) {
      if (currentEnd > -Infinity) total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    } else if (end > currentEnd) {
      currentEnd = end;
    }
  }
  if (currentEnd > -Infinity) total += currentEnd - currentStart;
  // A small tolerance so a span of exactly five calendar years (1,826 days with a leap day) counts as five.
  return Math.floor(total / (365.25 * 24 * 60 * 60 * 1000) + 0.01);
}
