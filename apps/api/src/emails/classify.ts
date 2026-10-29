import type { ApplicationState, EmailClass } from '../db/schema.js';
import { TRANSITIONS } from '../applications/engine.js';

/**
 * Reads an employer's email and says what kind it is. Deliberately plain: weighted phrases, so every
 * answer can show the phrases it rested on ("signals"). The text is untrusted and is only ever
 * matched, never followed; the result is a suggestion that a person accepts or dismisses.
 */
interface Rule {
  kind: Exclude<EmailClass, 'OTHER'>;
  weight: number;
  pattern: RegExp;
  label: string;
}

const RULES: Rule[] = [
  {
    kind: 'REJECTION',
    weight: 3,
    pattern: /\b(regret|unfortunately|sorry) (to (inform|tell)|that)\b/i,
    label: 'regret to inform',
  },
  {
    kind: 'REJECTION',
    weight: 3,
    pattern: /\bnot (be )?(moving|going|proceeding) (forward|ahead|further)\b/i,
    label: 'not moving forward',
  },
  {
    kind: 'REJECTION',
    weight: 3,
    pattern: /\b(decided|chosen|chose) to (move|proceed|go) (forward )?with (other|another)\b/i,
    label: 'chose other candidates',
  },
  { kind: 'REJECTION', weight: 2, pattern: /\bother candidates\b/i, label: 'other candidates' },
  {
    kind: 'REJECTION',
    weight: 2,
    pattern: /\b(position|role) (has been|was|is now) filled\b/i,
    label: 'position filled',
  },
  {
    kind: 'REJECTION',
    weight: 2,
    pattern: /\bwill not be (moving|taking)\b/i,
    label: 'will not be taking',
  },
  {
    kind: 'OFFER',
    weight: 4,
    pattern: /\b(pleased|delighted|excited|happy) to (offer|extend)\b/i,
    label: 'pleased to offer',
  },
  { kind: 'OFFER', weight: 3, pattern: /\boffer letter\b/i, label: 'offer letter' },
  {
    kind: 'OFFER',
    weight: 3,
    pattern: /\b(compensation|salary) package\b/i,
    label: 'compensation package',
  },
  {
    kind: 'OFFER',
    weight: 2,
    pattern: /\b(start date|accept (this|the) offer|sign (and return|the offer))\b/i,
    label: 'start date / accept',
  },
  {
    kind: 'ASSESSMENT',
    weight: 3,
    pattern:
      /\b(coding (challenge|test|exercise)|take[- ]home|technical (assessment|test)|online assessment)\b/i,
    label: 'assessment',
  },
  {
    kind: 'ASSESSMENT',
    weight: 2,
    pattern: /\b(hackerrank|codility|codesignal|testgorilla)\b/i,
    label: 'assessment platform',
  },
  {
    kind: 'INTERVIEW_INVITE',
    weight: 3,
    pattern: /\b(invite|invitation|like) (you )?to (an? )?(interview|chat|call|meet)\b/i,
    label: 'invitation to interview',
  },
  {
    kind: 'INTERVIEW_INVITE',
    weight: 3,
    pattern:
      /\b(schedule|book|arrange|set up) (a|an|your|the) (\w+ )?(interview|call|conversation|chat)\b/i,
    label: 'schedule an interview',
  },
  {
    kind: 'INTERVIEW_INVITE',
    weight: 2,
    pattern: /\b(your availability|available (for|on)|calendar (invite|link)|calendly)\b/i,
    label: 'availability / calendar',
  },
  { kind: 'INTERVIEW_INVITE', weight: 1, pattern: /\binterview\b/i, label: 'interview' },
  {
    kind: 'RECEIPT',
    weight: 3,
    pattern:
      /\b(thank(s| you) for (applying|your (application|interest))|received your application|we('ve| have) received)\b/i,
    label: 'application received',
  },
  {
    kind: 'RECEIPT',
    weight: 1,
    pattern: /\b(review (your|the) application|will be in touch)\b/i,
    label: 'will be in touch',
  },
];

/** What a classification suggests, in order of preference; the first one the pipeline allows from the current state is offered. */
const SUGGESTED: Partial<Record<EmailClass, ApplicationState[]>> = {
  INTERVIEW_INVITE: ['SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW'],
  ASSESSMENT: ['SCREENING'],
  OFFER: ['OFFER'],
  REJECTION: ['REJECTED'],
};

export interface EmailVerdict {
  classification: EmailClass;
  /** 0 to 1. A guide, not a probability. */
  confidence: number;
  /** The phrases the answer rested on. */
  signals: string[];
  suggestedState: ApplicationState | null;
}

/** Offers and rejections outrank an invitation that happens to be in the same email ("we will not be scheduling an interview"). */
const PRIORITY: Record<EmailClass, number> = {
  OFFER: 5,
  REJECTION: 4,
  ASSESSMENT: 3,
  INTERVIEW_INVITE: 2,
  RECEIPT: 1,
  OTHER: 0,
};

export function classifyEmail(
  subject: string,
  body: string,
  currentState: ApplicationState,
): EmailVerdict {
  const text = `${subject}\n${body}`.slice(0, 20_000);
  const scores = new Map<EmailClass, { score: number; signals: string[] }>();
  for (const rule of RULES) {
    if (!rule.pattern.test(text)) continue;
    const entry = scores.get(rule.kind) ?? { score: 0, signals: [] };
    entry.score += rule.weight;
    entry.signals.push(rule.label);
    scores.set(rule.kind, entry);
  }
  // A rejection that mentions interviews is still a rejection: the interview words only count when no stronger kind fired.
  let best: EmailClass = 'OTHER';
  let bestScore = 0;
  for (const [kind, { score }] of scores) {
    if (score > bestScore || (score === bestScore && PRIORITY[kind] > PRIORITY[best])) {
      best = kind;
      bestScore = score;
    }
  }
  if (bestScore < 2)
    return { classification: 'OTHER', confidence: 0.2, signals: [], suggestedState: null };
  const total = [...scores.values()].reduce((sum, e) => sum + e.score, 0);
  const confidence = Math.min(
    0.99,
    Math.round((bestScore / total) * Math.min(1, 0.4 + bestScore / 8) * 100) / 100,
  );
  const allowed = TRANSITIONS[currentState];
  const suggestedState = (SUGGESTED[best] ?? []).find((s) => allowed.includes(s)) ?? null;
  return { classification: best, confidence, signals: scores.get(best)!.signals, suggestedState };
}
