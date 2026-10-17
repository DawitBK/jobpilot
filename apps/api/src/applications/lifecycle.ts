import { ProblemException, notFound } from '@jobpilot/kit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { enqueue, recordAudit } from '../common/audit.js';
import type { Tx } from '../db/db.module.js';
import {
  applicationEvents,
  applications,
  type ActorType,
  type ApplicationRow,
  type ApplicationState,
} from '../db/schema.js';
import { validateTransition } from './engine.js';

export interface Actor {
  type: ActorType;
  userId: string | null;
}

export interface TransitionContext {
  actor: Actor;
  eventType: string;
  payload?: Record<string, unknown>;
}

/** Start an application for a candidate and a job, and move it on to MATCHED (the person or the engine chose it). */
export async function createApplication(
  tx: Tx,
  input: {
    organizationId: string;
    candidateProfileId: string;
    jobId: string;
    actor: Actor;
    payload?: Record<string, unknown>;
  },
): Promise<ApplicationRow> {
  const [created] = await tx
    .insert(applications)
    .values({
      organizationId: input.organizationId,
      candidateProfileId: input.candidateProfileId,
      jobId: input.jobId,
    })
    .returning();
  await tx.insert(applicationEvents).values({
    organizationId: input.organizationId,
    applicationId: created!.id,
    fromState: null,
    toState: 'DISCOVERED',
    actorType: input.actor.type,
    actorId: input.actor.userId,
    eventType: 'application.created',
    payload: input.payload ?? {},
  });
  await enqueue(tx, input.organizationId, 'application.discovered', {
    applicationId: created!.id,
    jobId: input.jobId,
    candidateProfileId: input.candidateProfileId,
  });
  return transition(tx, input.organizationId, created!.id, 'MATCHED', {
    actor: input.actor,
    eventType: 'application.matched',
    payload: input.payload,
  });
}

/**
 * Move an application to a new state, inside the caller's transaction: lock it, check the move,
 * change it, record the event, announce it, and write the audit row. All or nothing.
 */
export async function transition(
  tx: Tx,
  organizationId: string,
  applicationId: string,
  to: ApplicationState,
  ctx: TransitionContext,
): Promise<ApplicationRow> {
  const [app] = await tx
    .select()
    .from(applications)
    .where(eq(applications.id, applicationId))
    .for('update');
  if (!app) throw notFound(`Application ${applicationId} does not exist`);
  validateTransition(app.state, to, ctx.actor.type);

  const payload: Record<string, unknown> = { ...(ctx.payload ?? {}) };
  if (to === 'NEEDS_HUMAN_REVIEW') payload['returnTo'] = app.state;
  if (app.state === 'NEEDS_HUMAN_REVIEW' && to !== 'WITHDRAWN') {
    // It can only go back to where it came from.
    const [left] = await tx
      .select({ payload: applicationEvents.payload })
      .from(applicationEvents)
      .where(
        and(
          eq(applicationEvents.applicationId, applicationId),
          eq(applicationEvents.toState, 'NEEDS_HUMAN_REVIEW'),
        ),
      )
      .orderBy(desc(applicationEvents.createdAt), desc(applicationEvents.id))
      .limit(1);
    const returnTo = (left?.payload as { returnTo?: string } | undefined)?.returnTo;
    if (returnTo !== to) {
      throw new ProblemException(
        409,
        'wrong-return-state',
        'It can only go back to where it came from',
        `This application was ${returnTo ?? 'unknown'} before review`,
        { returnTo },
      );
    }
  }

  const [updated] = await tx
    .update(applications)
    .set({
      state: to,
      stateEnteredAt: sql`now()`,
      version: sql`${applications.version} + 1`,
      ...(to === 'APPROVED' ? { approvedBy: ctx.actor.userId, approvedAt: sql`now()` } : {}),
      ...(to === 'APPLIED' ? { appliedAt: sql`now()` } : {}),
    })
    .where(eq(applications.id, applicationId))
    .returning();
  await tx.insert(applicationEvents).values({
    organizationId,
    applicationId,
    fromState: app.state,
    toState: to,
    actorType: ctx.actor.type,
    actorId: ctx.actor.userId,
    eventType: ctx.eventType,
    payload,
  });
  await enqueue(tx, organizationId, `application.${to.toLowerCase()}`, {
    applicationId,
    from: app.state,
    to,
  });
  await recordAudit(tx, {
    organizationId,
    actorUserId: ctx.actor.userId,
    actorType: ctx.actor.type,
    action: 'application.transitioned',
    resourceType: 'application',
    resourceId: applicationId,
    before: { state: app.state },
    after: { state: to },
  });
  return updated!;
}
