import { ProblemException } from '@jobpilot/kit';
import type { ActorType, ApplicationState } from '../db/schema.js';

/**
 * The application state machine. Every transition goes through `validateTransition`; there is no
 * other way to change a state.
 */
export const TRANSITIONS: Record<ApplicationState, readonly ApplicationState[]> = {
  DISCOVERED: ['MATCHED', 'EXPIRED'],
  MATCHED: ['SHORTLISTED', 'REJECTED', 'EXPIRED'],
  SHORTLISTED: ['RESUME_GENERATED', 'WITHDRAWN'],
  RESUME_GENERATED: ['COVER_LETTER_GENERATED', 'NEEDS_HUMAN_REVIEW', 'WITHDRAWN'],
  COVER_LETTER_GENERATED: ['READY_TO_APPLY', 'NEEDS_HUMAN_REVIEW', 'WITHDRAWN'],
  READY_TO_APPLY: ['APPROVED', 'NEEDS_HUMAN_REVIEW', 'WITHDRAWN'],
  APPROVED: ['APPLIED', 'NEEDS_HUMAN_REVIEW'],
  // Where it goes back to is whichever state it left, recorded in the event that sent it here.
  NEEDS_HUMAN_REVIEW: [
    'SHORTLISTED',
    'RESUME_GENERATED',
    'COVER_LETTER_GENERATED',
    'READY_TO_APPLY',
    'APPROVED',
    'WITHDRAWN',
  ],
  APPLIED: ['SCREENING', 'REJECTED', 'NO_RESPONSE', 'WITHDRAWN'],
  SCREENING: ['INTERVIEW', 'REJECTED', 'NO_RESPONSE'],
  INTERVIEW: ['FINAL_INTERVIEW', 'REJECTED', 'NO_RESPONSE'],
  FINAL_INTERVIEW: ['OFFER', 'REJECTED', 'NO_RESPONSE'],
  OFFER: ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
  ACCEPTED: [],
  REJECTED: [],
  WITHDRAWN: [],
  NO_RESPONSE: [],
  EXPIRED: [],
};

export const TERMINAL_STATES: readonly ApplicationState[] = (
  Object.keys(TRANSITIONS) as ApplicationState[]
).filter((s) => TRANSITIONS[s].length === 0);

export const isTerminal = (state: ApplicationState) => TERMINAL_STATES.includes(state);

/**
 * Throws unless the move is allowed. The one line that matters most: only a person can approve.
 * The browser worker and the AI are structurally unable to authorise a submission, because the
 * transition to APPROVED refuses any other kind of actor (a CHECK constraint says the same).
 */
export function validateTransition(
  from: ApplicationState,
  to: ApplicationState,
  actor: ActorType,
): void {
  if (to === 'APPROVED' && actor !== 'USER') {
    throw new ProblemException(
      403,
      'approval-requires-a-person',
      'Only a person can approve an application',
      `A ${actor} cannot move an application to APPROVED`,
    );
  }
  if (!TRANSITIONS[from].includes(to)) {
    throw new ProblemException(
      409,
      'invalid-transition',
      'That move is not allowed',
      isTerminal(from)
        ? `The application is ${from} and cannot change any more`
        : `An application that is ${from} can go to: ${TRANSITIONS[from].join(', ')}`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}
