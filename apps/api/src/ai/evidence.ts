/**
 * Evidence-linked generation. A model may write the prose of a resume or cover letter, but every
 * statement it makes must be checked against the candidate's own record before anyone relies on it.
 * The checking here is deterministic code (no model): it is explainable, repeatable and cannot be
 * talked into agreeing by text inside a job posting.
 *
 * Verdicts: SUPPORTED (everything checkable in the statement is in the record), UNSUPPORTED (it names
 * something that is not in the record), CONFLICTING (it contradicts the record: more years than the
 * record shows, "expert" where the record says intermediate), UNKNOWN (nothing in it can be checked,
 * for example an opinion).
 */

export interface CandidateRecord {
  fullName: string;
  headline: string | null;
  summary: string | null;
  yearsExperience: number;
  skills: { skillName: string; proficiency: string; yearsExperience: number | null }[];
  experience: {
    companyName: string;
    title: string;
    startDate: string;
    endDate: string | null;
    description: string | null;
    technologies: string[];
  }[];
  education: { institution: string; degree: string; field: string | null }[];
  projects: { name: string; description: string | null; technologies: string[] }[];
}

export interface Fact {
  id: string;
  kind: 'profile' | 'skill' | 'experience' | 'education' | 'project';
  text: string;
}

export const VERDICTS = ['SUPPORTED', 'UNSUPPORTED', 'CONFLICTING', 'UNKNOWN'] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Claim {
  text: string;
  /** What the model said backs the statement; kept for transparency, never trusted. */
  citedFactIds: string[];
}

export interface CheckedClaim extends Claim {
  verdict: Verdict;
  /** The record entries the checkable parts were actually found in. */
  evidenceFactIds: string[];
  detail: string;
}

/** The record as numbered facts. Contact details are deliberately not facts: they are never sent to a model. */
export function buildFacts(record: CandidateRecord): Fact[] {
  const facts: Fact[] = [];
  const add = (kind: Fact['kind'], text: string) =>
    facts.push({ id: `F${facts.length + 1}`, kind, text });
  add(
    'profile',
    [
      `Candidate: ${record.fullName}`,
      record.headline ? `Headline: ${record.headline}` : '',
      record.summary ? `Summary: ${record.summary}` : '',
      `Total professional experience: ${record.yearsExperience} years`,
    ]
      .filter(Boolean)
      .join('. '),
  );
  for (const s of record.skills) {
    add(
      'skill',
      `Skill: ${s.skillName} (${s.proficiency.toLowerCase()}${s.yearsExperience !== null ? `, ${s.yearsExperience} years` : ''})`,
    );
  }
  for (const e of record.experience) {
    add(
      'experience',
      `${e.title} at ${e.companyName}, ${e.startDate} to ${e.endDate ?? 'present'}.${e.description ? ` ${e.description}` : ''}${e.technologies.length ? ` Technologies: ${e.technologies.join(', ')}.` : ''}`,
    );
  }
  for (const e of record.education) {
    add('education', `${e.degree}${e.field ? ` in ${e.field}` : ''} at ${e.institution}`);
  }
  for (const p of record.projects) {
    add(
      'project',
      `Project ${p.name}.${p.description ? ` ${p.description}` : ''}${p.technologies.length ? ` Technologies: ${p.technologies.join(', ')}.` : ''}`,
    );
  }
  return facts;
}

// ------------------------------------------------------------------ personal data never leaves

/** Eight or more digits once punctuation is ignored, but not a date ("2021-03-01") or a year range ("2019-2021"). */
function looksLikePhone(run: string): boolean {
  const trimmed = run.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return false;
  if (/^(19|20)\d{2}\s*[-–]\s*(19|20)\d{2}$/.test(trimmed)) return false;
  return trimmed.replace(/\D/g, '').length >= 8;
}

/** Replaces emails, phone numbers and ID-like numbers with placeholders; `restore` puts them back in the model's output. */
export function redactPii(text: string): { text: string; map: Map<string, string>; count: number } {
  const map = new Map<string, string>();
  let n = 0;
  const swap = (label: string) => (match: string) => {
    const token = `[${label}_${(n += 1)}]`;
    map.set(token, match);
    return token;
  };
  const out = text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, swap('EMAIL'))
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, swap('ID'))
    // A phone-like run of digits: eight or more digits once spaces and punctuation are ignored (so "2019-2021" is left alone).
    .replace(/(?<![\w])\+?\d[\d\s().-]{7,}\d(?![\w])/g, (m) =>
      looksLikePhone(m) ? swap('PHONE')(m) : m,
    );
  return { text: out, map, count: map.size };
}

export function restorePii(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [token, original] of map) out = out.split(token).join(original);
  return out;
}

// ------------------------------------------------------------------ untrusted text

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the |your )?(previous|prior|above|earlier|preceding) (instructions|rules|prompts?)/i,
  /disregard (all |any |the |your )?(previous|prior|above|earlier)? ?(instructions|rules|prompts?)/i,
  /you are (now|no longer) /i,
  /(reveal|print|show|repeat) (your |the )?(system )?(prompt|instructions)/i,
  /(approve|accept|submit|send) (this|the|every|all) (application|resume|candidate)s?/i,
  /\b(act|behave|respond) as (if|an?|the)\b/i,
  /<\|?(im_start|system|assistant)\|?>|\[\/?(system|inst)\]/i,
  /(do not|don't) (tell|inform|mention)/i,
  /\bnew instructions?:/i,
];

/** Phrases in a job posting or a record that read like orders to a model. They are flagged and the result is stopped for a person. */
export function findInjectionAttempts(...texts: (string | null | undefined)[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    for (const pattern of INJECTION_PATTERNS) {
      const m = pattern.exec(text);
      if (m) found.push(m[0].slice(0, 80));
    }
  }
  return [...new Set(found)];
}

// ------------------------------------------------------------------ checking a claim

/** Technologies and tools worth checking by name even when the candidate has not listed them. */
const KNOWN_TERMS = [
  'typescript',
  'javascript',
  'node',
  'node.js',
  'react',
  'next.js',
  'angular',
  'vue',
  'python',
  'java',
  'kotlin',
  'swift',
  'go',
  'golang',
  'rust',
  'c#',
  'c++',
  'ruby',
  'php',
  'sql',
  'postgresql',
  'postgres',
  'mysql',
  'mongodb',
  'redis',
  'kafka',
  'rabbitmq',
  'graphql',
  'rest',
  'grpc',
  'docker',
  'kubernetes',
  'terraform',
  'ansible',
  'aws',
  'azure',
  'gcp',
  'linux',
  'git',
  'jenkins',
  'prometheus',
  'grafana',
  'spark',
  'airflow',
  'dbt',
  'pytorch',
  'tensorflow',
  'elasticsearch',
  'css',
  'html',
  'accessibility',
  'figma',
];

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
};

/** "ten years", "Ten-year", "five+ years": number words matter because a model writes them. */
const NUMBER_WORD_YEARS = new RegExp(
  String.raw`\b(${Object.keys(NUMBER_WORDS).join('|')})\b[\s-]*(?:\+\s*)?(?:years?|yrs?)`,
  'gi',
);

const PROFICIENCY_RANK: Record<string, number> = {
  BEGINNER: 1,
  INTERMEDIATE: 2,
  ADVANCED: 3,
  EXPERT: 4,
};
const STOP = new Set([
  'I',
  'My',
  'The',
  'A',
  'An',
  'In',
  'At',
  'On',
  'For',
  'With',
  'And',
  'But',
  'As',
  'Of',
  'To',
  'JobPilot',
  // Months and days are dates, not names: they are checked as dates below.
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
]);

const MONTH_NUMBER: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH_YEAR =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+((?:19|20)\d{2})\b/gi;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (text: string, term: string) =>
  new RegExp(`(?<![\\w.])${esc(term)}(?![\\w])`, 'i').test(text);

function proseVocabulary(extra: string[]): string[] {
  return [...new Set([...KNOWN_TERMS, ...extra.map((t) => t.toLowerCase())])];
}

/** The parts of a statement that can be checked: numbers, technologies and names. */
export function checkableParts(text: string, vocabulary: string[]) {
  const terms = proseVocabulary(vocabulary).filter((t) => mentions(text, t));
  const years = [
    ...[...text.matchAll(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/gi)].map((m) => Number(m[1])),
    ...[...text.matchAll(NUMBER_WORD_YEARS)].map((m) => NUMBER_WORDS[m[1]!.toLowerCase()]!),
    ...(/\b(a|one|two|three) decades?\b/i.test(text) ? [10] : []),
  ];
  const numbers = [
    ...text.matchAll(
      /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s*(%|k\b|m\b|million|thousand|users|requests|services|people|engineers|customers)?/gi,
    ),
  ]
    .filter((m) => !/^(\d+(?:\.\d+)?)\s*\+?\s*(years?|yrs?)$/i.test(m[0].trim()))
    .map((m) => m[0].trim().replace(/,+$/, ''))
    .filter((n) => /\d{2,}|[%kKmM]/.test(n))
    // A year ("2021") is a date: it is checked as one, below, against the dates the record holds.
    .filter((n) => !/^(19|20)\d{2}$/.test(n))
    .filter((n) => !years.some((y) => n.startsWith(String(y))));
  const monthYears = [...text.matchAll(MONTH_YEAR)].map((m) => ({
    label: `${m[1]} ${m[2]}`,
    key: `${m[2]}-${String(MONTH_NUMBER[m[1]!.slice(0, 3).toLowerCase()]).padStart(2, '0')}`,
  }));
  const withoutMonthYears = text.replace(MONTH_YEAR, ' ');
  const bareYears = [...withoutMonthYears.matchAll(/(?<![\w.-])((?:19|20)\d{2})(?![\w-])/g)].map(
    (m) => m[1]!,
  );
  const names: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    let run: string[] = [];
    const flush = () => {
      const name = run.join(' ');
      if (name && !terms.some((t) => t.toLowerCase() === name.toLowerCase())) names.push(name);
      run = [];
    };
    words.forEach((raw) => {
      const w = raw.replace(/^[("'`]+|[)"'`.,;:!?]+$/g, '');
      const capital = /^[A-Z][A-Za-z0-9&-]*$/.test(w) && !STOP.has(w);
      const isTerm = terms.some((t) => t.toLowerCase() === w.toLowerCase());
      if (capital && !isTerm) run.push(w);
      else flush();
    });
    flush();
  }
  // A sentence-initial single capitalised word is just a capital letter, not a name.
  const properNames = names.filter((name) => {
    if (name.includes(' ')) return true;
    return sentences.some((s) => !s.trimStart().startsWith(name) && s.includes(name));
  });
  return { terms, years, numbers, monthYears, bareYears, names: [...new Set(properNames)] };
}

/**
 * A letter is addressed to the employer it applies to, so naming the company or the role from the posting says
 * nothing about the candidate and is fine. What is not fine is using that name as if it were the candidate's past:
 * "I worked at Northwind Cloud" or "At Northwind Cloud I built ..." when the record has no such job.
 */
function claimsPastWith(text: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Dear hiring team at Northwind Cloud," is a greeting, not a claim about where the candidate has worked.
  const body = text.replace(/^\s*(?:dear|hello|hi)\b[^,\n]*,\s*/i, '');
  return new RegExp(
    String.raw`\b(?:worked|work|working|employed|served|interned|joined|spent|previously|formerly)\b[^.!?\n]{0,60}${n}|\b(?:at|for|with|from)\s+${n}\s*(?:,\s*)?(?:I|we|where|my)\b|\bmy\s+(?:time|years?|role|experience|tenure|work)\s+(?:at|with|for)\s+${n}`,
    'i',
  ).test(body);
}

export function verifyClaims(
  claims: Claim[],
  facts: Fact[],
  record: CandidateRecord,
  /** Names that come from the job posting (its company and title): allowed as the addressee, never as the candidate's past. */
  postingNames: string[] = [],
): CheckedClaim[] {
  const vocabulary = [
    ...record.skills.map((s) => s.skillName),
    ...record.experience.flatMap((e) => e.technologies),
    ...record.projects.flatMap((p) => p.technologies),
  ];
  const known = new Set(facts.map((f) => f.id));
  return claims.map((claim) => {
    const parts = checkableParts(claim.text, vocabulary);
    const found = (needle: string) =>
      facts.filter((f) => mentions(f.text, needle)).map((f) => f.id);
    const evidence = new Set<string>();
    const missing: string[] = [];
    const conflicts: string[] = [];

    for (const term of parts.terms) {
      const where = found(term);
      where.forEach((id) => evidence.add(id));
      if (where.length === 0) missing.push(term);
    }
    for (const name of parts.names) {
      const where = found(name);
      where.forEach((id) => evidence.add(id));
      if (where.length > 0) continue;
      const fromPosting = postingNames.some(
        (p) =>
          p.toLowerCase().includes(name.toLowerCase()) ||
          name.toLowerCase().includes(p.toLowerCase()),
      );
      if (fromPosting && !claimsPastWith(claim.text, name)) continue;
      missing.push(name);
    }
    // Dates must be dates the record actually holds ("February 2020" needs a 2020-02 entry; "since 2018" needs a 2018).
    for (const date of parts.monthYears) {
      const where = facts.filter((f) => f.text.includes(date.key)).map((f) => f.id);
      where.forEach((id) => evidence.add(id));
      if (where.length === 0) missing.push(date.label);
    }
    for (const year of parts.bareYears) {
      const where = facts.filter((f) => f.text.includes(year)).map((f) => f.id);
      where.forEach((id) => evidence.add(id));
      if (where.length === 0) missing.push(year);
    }
    for (const number of parts.numbers) {
      const where = facts.filter((f) => f.text.includes(number)).map((f) => f.id);
      where.forEach((id) => evidence.add(id));
      if (where.length === 0) missing.push(number);
    }
    for (const years of parts.years) {
      // "N years" is checked against the skill it is about, or the whole career when no skill is named.
      const skillsNamed = record.skills.filter((s) => mentions(claim.text, s.skillName));
      const limits = skillsNamed.length
        ? skillsNamed.map((s) => s.yearsExperience)
        : [record.yearsExperience];
      const shown = limits.filter((l): l is number => l !== null);
      if (shown.length && years > Math.max(...shown) + 0.5) {
        conflicts.push(`says ${years} years, the record shows ${Math.max(...shown)}`);
      } else if (shown.length === 0) {
        missing.push(`${years} years`);
      }
    }
    if (/\b(expert|mastery|master)\b/i.test(claim.text)) {
      for (const s of record.skills.filter((x) => mentions(claim.text, x.skillName))) {
        if ((PROFICIENCY_RANK[s.proficiency] ?? 0) < PROFICIENCY_RANK['EXPERT']!) {
          conflicts.push(
            `says expert in ${s.skillName}, the record says ${s.proficiency.toLowerCase()}`,
          );
        }
      }
    }

    const citedKnown = claim.citedFactIds.filter((id) => known.has(id));
    const evidenceFactIds = [...evidence];
    if (conflicts.length > 0) {
      return {
        ...claim,
        verdict: 'CONFLICTING' as const,
        evidenceFactIds,
        detail: `Contradicts the record: ${conflicts.join('; ')}.`,
      };
    }
    if (missing.length > 0) {
      return {
        ...claim,
        verdict: 'UNSUPPORTED' as const,
        evidenceFactIds,
        detail: `Not in the record: ${missing.join(', ')}.`,
      };
    }
    const checkable =
      parts.terms.length + parts.names.length + parts.numbers.length + parts.years.length;
    if (checkable === 0) {
      return {
        ...claim,
        verdict: 'UNKNOWN' as const,
        evidenceFactIds: citedKnown,
        detail:
          'Nothing in this statement can be checked against the record (an opinion or a general remark).',
      };
    }
    return {
      ...claim,
      verdict: 'SUPPORTED' as const,
      evidenceFactIds: evidenceFactIds.length ? evidenceFactIds : citedKnown,
      detail: 'Everything checkable here is in the record.',
    };
  });
}

export function tallyVerdicts(claims: CheckedClaim[]): Record<string, number> {
  const tally: Record<string, number> = {};
  for (const c of claims) tally[c.verdict] = (tally[c.verdict] ?? 0) + 1;
  return tally;
}
