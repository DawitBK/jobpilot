import { createHash } from 'node:crypto';
import { normalizeSkill, type RemoteType, type Seniority } from '../matching/score.js';

/** What a connector hands over, before anything has been understood about it. */
export interface RawPosting {
  externalId: string | null;
  title: string;
  company: string;
  location: string | null;
  /** Plain text or HTML. */
  description: string;
  url: string | null;
  postedAt: Date | null;
}

export interface NormalizedJob {
  externalId: string | null;
  companyName: string;
  title: string;
  description: string;
  location: string | null;
  remoteType: RemoteType;
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: Seniority | null;
  requiredSkills: string[];
  preferredSkills: string[];
  visaSponsorship: boolean | null;
  applicationUrl: string | null;
  postedAt: Date | null;
  dedupHash: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
};

/** `&#x27;`, `&#8217;` and the common named ones; anything unknown is left as it was. */
function decodeEntity(whole: string, body: string): string {
  const lower = body.toLowerCase();
  if (lower.startsWith('#x') || lower.startsWith('#')) {
    const code = lower.startsWith('#x')
      ? parseInt(lower.slice(2), 16)
      : parseInt(lower.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  }
  return NAMED[lower] ?? whole;
}

/** Turn the HTML of a posting into readable text (and unescape the HTML that arrives escaped). */
export function toPlainText(input: string): string {
  let text = input;
  // Greenhouse delivers its content HTML-escaped inside JSON: unescape first, then strip tags.
  if (!/<[a-z][\s\S]*>/i.test(text) && /&lt;[a-z]/i.test(text)) {
    text = text.replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);
  }
  return text
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, decodeEntity)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** The technologies the rules recognise in a posting. Anything else is for the AI layer later. */
const SKILL_TERMS = [
  'javascript',
  'typescript',
  'python',
  'java',
  'rust',
  'ruby',
  'php',
  'csharp',
  '.net',
  'c++',
  'swift',
  'kotlin',
  'react',
  'next.js',
  'vue',
  'angular',
  'svelte',
  'node.js',
  'nestjs',
  'django',
  'flask',
  'spring',
  'rails',
  'laravel',
  'postgresql',
  'mysql',
  'mongodb',
  'redis',
  'elasticsearch',
  'sql',
  'graphql',
  'docker',
  'kubernetes',
  'terraform',
  'ansible',
  'amazon web services',
  'google cloud',
  'azure',
  'linux',
  'git',
  'ci/cd',
  'kafka',
  'rabbitmq',
  'tailwind',
  'html',
  'css',
  'machine learning',
  'pytorch',
  'tensorflow',
  'figma',
] as const;

function skillRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Word-ish boundaries that also work around dots, plus signs and slashes ("c++", "node.js", "ci/cd").
  return new RegExp(`(?<![\\w.+#])${escaped}(?![\\w])`, 'i');
}

const SKILL_PATTERNS: [string, RegExp][] = [
  ...SKILL_TERMS.map((t) => [t, skillRegex(t)] as [string, RegExp]),
  // Spellings people actually write, mapped to the canonical term.
  ['javascript', /\bjs\b/i],
  ['typescript', /\bts\b/i],
  ['node.js', /\bnode(?:js)?\b/i],
  ['postgresql', /\bpostgres\b/i],
  ['kubernetes', /\bk8s\b/i],
  ['amazon web services', /\baws\b/i],
  ['google cloud', /\bgcp\b/i],
  ['csharp', /c#/i],
  ['go', /\bgolang\b/i],
  ['express', /\bexpress(?:\.js|js)\b/i],
  ['rest', /\brest(?:ful)?\s+apis?\b/i],
];

export function extractSkills(text: string): string[] {
  const found = new Set<string>();
  for (const [skill, re] of SKILL_PATTERNS) if (re.test(text)) found.add(normalizeSkill(skill));
  return [...found];
}

const PREFERRED_MARKER = /\b(nice[- ]to[- ]have|preferred|bonus|a plus|good to have|desirable)\b/i;

export function extractSalary(text: string): { min: number | null; max: number | null } {
  // "$120,000 - $150,000", "120k-150k", "ETB 80,000 to 100,000"
  const m = text.match(
    /(?:[$€£]|usd|eur|etb)?\s*(\d{2,3}(?:,\d{3})+|\d{2,3}\s?k)\s*(?:-|–|to)\s*(?:[$€£]|usd|eur|etb)?\s*(\d{2,3}(?:,\d{3})+|\d{2,3}\s?k)/i,
  );
  if (!m) return { min: null, max: null };
  const toNumber = (s: string) =>
    /k$/i.test(s.trim()) ? parseInt(s, 10) * 1000 : parseInt(s.replace(/,/g, ''), 10);
  const a = toNumber(m[1]!);
  const b = toNumber(m[2]!);
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

export function extractSeniority(title: string): Seniority | null {
  const t = title.toLowerCase();
  if (/\b(principal|distinguished)\b/.test(t)) return 'PRINCIPAL';
  if (/\bstaff\b/.test(t)) return 'STAFF';
  if (/\b(senior|sr\.?|lead)\b/.test(t)) return 'SENIOR';
  if (/\b(junior|jr\.?|entry|graduate|intern(?:ship)?|trainee)\b/.test(t)) return 'ENTRY';
  if (/\b(mid|intermediate)\b/.test(t)) return 'MID';
  return null;
}

export function extractRemoteType(
  title: string,
  location: string | null,
  body: string,
): RemoteType {
  const head = `${title} ${location ?? ''}`.toLowerCase();
  if (/\bremote\b/.test(head)) return 'REMOTE';
  if (/\bhybrid\b/.test(head)) return 'HYBRID';
  const text = body.toLowerCase();
  if (/\b(fully|100%)\s+remote\b|\bremote[- ]first\b|\bwork from anywhere\b/.test(text))
    return 'REMOTE';
  if (/\bhybrid\b/.test(text)) return 'HYBRID';
  // "Remote." or "This role is remote" counts, unless the posting also rules it out.
  if (/\bremote\b/.test(text) && !/\b(not|no)\s+remote\b|on-?site|in[- ]office/.test(text)) {
    return 'REMOTE';
  }
  return 'ONSITE';
}

export function extractVisa(text: string): boolean | null {
  const t = text.toLowerCase();
  if (/(no|not|unable to|cannot|can't)\s+(?:\w+\s+){0,3}(visa )?sponsor/.test(t)) return false;
  if (/visa sponsorship (is )?(available|provided|offered)|we (?:do )?sponsor/.test(t)) return true;
  return null;
}

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The identity of a posting: the same company, title and place is the same job, from any source. */
export const dedupHashOf = (company: string, title: string, location: string | null): string =>
  createHash('sha256')
    .update([squash(company), squash(title), squash(location ?? '')].join('|'))
    .digest('hex');

export const normalizeCompany = (name: string): string => squash(name);

export function normalizePosting(raw: RawPosting): NormalizedJob {
  const description = toPlainText(raw.description);
  const title = raw.title.trim();
  const company = raw.company.trim();
  const marker = description.search(PREFERRED_MARKER);
  const requiredText = marker >= 0 ? description.slice(0, marker) : description;
  const preferredText = marker >= 0 ? description.slice(marker) : '';
  const required = extractSkills(`${title}\n${requiredText}`);
  const preferred = extractSkills(preferredText).filter((s) => !required.includes(s));
  const salary = extractSalary(description);
  return {
    externalId: raw.externalId,
    companyName: company,
    title,
    description,
    location: raw.location?.trim() || null,
    remoteType: extractRemoteType(title, raw.location, description),
    salaryMin: salary.min,
    salaryMax: salary.max,
    seniority: extractSeniority(title),
    requiredSkills: required,
    preferredSkills: preferred,
    visaSponsorship: extractVisa(description),
    applicationUrl: raw.url && /^https?:\/\//i.test(raw.url) ? raw.url : null,
    postedAt: raw.postedAt,
    dedupHash: dedupHashOf(company, title, raw.location),
  };
}
