import type { ApplicationState } from '../db/schema.js';

export type NotificationKind =
  | 'WELCOME'
  | 'NEW_MATCH'
  | 'APPROVAL_NEEDED'
  | 'APPLICATION_UPDATE'
  | 'NEEDS_REVIEW'
  | 'JOBS_FOUND'
  | 'SECURITY'
  | 'PLAN';

export interface Draft {
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  /** Worth an email as well as the in-app message. */
  email: boolean;
}

const UPDATE_TEXT: Partial<Record<ApplicationState, { title: string; email: boolean }>> = {
  APPROVED: { title: 'was approved', email: false },
  APPLIED: { title: 'was sent', email: false },
  SCREENING: { title: 'is in screening', email: false },
  INTERVIEW: { title: 'moved to interview', email: true },
  FINAL_INTERVIEW: { title: 'moved to the final interview', email: true },
  OFFER: { title: 'received an offer', email: true },
  ACCEPTED: { title: 'was accepted', email: true },
  REJECTED: { title: 'was rejected', email: false },
  NO_RESPONSE: { title: 'was marked no response', email: false },
  WITHDRAWN: { title: 'was withdrawn', email: false },
  EXPIRED: { title: 'expired', email: false },
};

/** What an application event says to the person, in plain words. */
export function applicationDraft(
  to: ApplicationState,
  from: ApplicationState | null,
  facts: {
    applicationId: string;
    jobTitle: string;
    companyName: string;
    score?: number | null;
    recommendation?: string | null;
  },
): Draft | null {
  const what = `${facts.jobTitle} at ${facts.companyName}`;
  const link = `/applications/${facts.applicationId}`;
  if (to === 'MATCHED' && from === 'DISCOVERED') {
    return {
      kind: 'NEW_MATCH',
      title: `New match: ${what}`,
      body:
        facts.score !== null && facts.score !== undefined
          ? `Score ${facts.score}${facts.recommendation ? `, recommendation ${facts.recommendation}` : ''}. Open it to decide whether to go on.`
          : 'Open it to decide whether to go on.',
      link,
      email: false,
    };
  }
  if (to === 'READY_TO_APPLY') {
    return {
      kind: 'APPROVAL_NEEDED',
      title: `Waiting for your approval: ${what}`,
      body: 'The application is ready. Nothing is sent until a person approves it.',
      link,
      email: true,
    };
  }
  if (to === 'NEEDS_HUMAN_REVIEW') {
    return {
      kind: 'NEEDS_REVIEW',
      title: `Needs your review: ${what}`,
      body: 'Something was stopped for a person to look at before it goes on.',
      link,
      email: true,
    };
  }
  const update = UPDATE_TEXT[to];
  if (update) {
    return {
      kind: 'APPLICATION_UPDATE',
      title: `${what} ${update.title}`,
      body: from ? `It moved from ${from} to ${to}.` : `It is now ${to}.`,
      link,
      email: update.email,
    };
  }
  return null;
}
