import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound } from '@jobpilot/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { transition } from '../applications/lifecycle.js';
import { TRANSITIONS } from '../applications/engine.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import { APPLICATION_STATES, EMAIL_CLASSES, applicationEmails } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { classifyEmail } from './classify.js';

export const logEmailSchema = z
  .object({
    fromAddress: z.string().trim().toLowerCase().max(254).pipe(z.email()),
    subject: z.string().trim().min(1).max(300),
    body: z.string().trim().min(1).max(20_000),
    receivedAt: z.iso.datetime().optional(),
  })
  .strict();
export type LogEmail = z.output<typeof logEmailSchema>;

export const emailSchema = z.object({
  id: z.uuid(),
  fromAddress: z.string(),
  subject: z.string(),
  body: z.string(),
  receivedAt: z.iso.datetime(),
  classification: z.enum(EMAIL_CLASSES),
  confidence: z.number(),
  signals: z.array(z.string()),
  suggestedState: z.enum(APPLICATION_STATES).nullable(),
  status: z.enum(['NEW', 'ACTED', 'DISMISSED']),
  decidedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type EmailDto = z.output<typeof emailSchema>;

const toDto = (e: typeof applicationEmails.$inferSelect): EmailDto => ({
  id: e.id,
  fromAddress: e.fromAddress,
  subject: e.subject,
  body: e.body,
  receivedAt: e.receivedAt.toISOString(),
  classification: e.classification,
  confidence: Number(e.confidence),
  signals: e.signals,
  suggestedState: e.suggestedState,
  status: e.status,
  decidedAt: e.decidedAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
});

/**
 * Employer emails logged against an application. A person pastes (or forwards) the email; it is
 * classified and a move is suggested, but the application only moves when a person clicks. Reading
 * mailboxes through Gmail or Outlook needs OAuth credentials for those services and is not built.
 */
@Injectable()
export class EmailsService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
  ) {}

  async log(p: Principal, applicationId: string, input: LogEmail): Promise<EmailDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const app = await this.applications.mustSee(tx, p, applicationId);
      const verdict = classifyEmail(input.subject, input.body, app.state);
      const [row] = await tx
        .insert(applicationEmails)
        .values({
          organizationId: p.organizationId,
          applicationId,
          fromAddress: input.fromAddress,
          subject: input.subject,
          body: input.body,
          receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
          classification: verdict.classification,
          confidence: verdict.confidence.toFixed(2),
          signals: verdict.signals,
          suggestedState: verdict.suggestedState,
          createdBy: p.userId,
        })
        .returning();
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'email.logged',
        resourceType: 'application',
        resourceId: applicationId,
        after: { classification: verdict.classification, suggestedState: verdict.suggestedState },
      });
      return toDto(row!);
    });
  }

  async list(p: Principal, applicationId: string): Promise<EmailDto[]> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.applications.mustSee(tx, p, applicationId);
      const rows = await tx
        .select()
        .from(applicationEmails)
        .where(eq(applicationEmails.applicationId, applicationId))
        .orderBy(asc(applicationEmails.receivedAt), asc(applicationEmails.id));
      return rows.map(toDto);
    });
  }

  /** The person accepts the suggestion: the application moves, as them, and the email is marked as acted on. */
  async apply(p: Principal, applicationId: string, emailId: string): Promise<EmailDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const app = await this.applications.mustSee(tx, p, applicationId);
      const email = await this.pending(tx, applicationId, emailId);
      if (!email.suggestedState)
        throw conflict('no-suggestion', 'This email did not suggest a move');
      if (!TRANSITIONS[app.state].includes(email.suggestedState)) {
        throw conflict(
          'suggestion-out-of-date',
          'The application has moved since this email was logged',
          `It is ${app.state} now, and ${email.suggestedState} is no longer the next step.`,
        );
      }
      await transition(tx, p.organizationId, applicationId, email.suggestedState, {
        actor: { type: 'USER', userId: p.userId },
        eventType: `application.${email.suggestedState.toLowerCase()}`,
        payload: {
          fromEmail: email.id,
          subject: email.subject,
          classification: email.classification,
        },
      });
      const [row] = await tx
        .update(applicationEmails)
        .set({ status: 'ACTED', decidedBy: p.userId, decidedAt: new Date() })
        .where(eq(applicationEmails.id, emailId))
        .returning();
      return toDto(row!);
    });
  }

  async dismiss(p: Principal, applicationId: string, emailId: string): Promise<EmailDto> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.applications.mustSee(tx, p, applicationId);
      await this.pending(tx, applicationId, emailId);
      const [row] = await tx
        .update(applicationEmails)
        .set({ status: 'DISMISSED', decidedBy: p.userId, decidedAt: new Date() })
        .where(eq(applicationEmails.id, emailId))
        .returning();
      return toDto(row!);
    });
  }

  private async pending(
    tx: Parameters<Parameters<TenantDb['inTenant']>[1]>[0],
    applicationId: string,
    emailId: string,
  ) {
    const [email] = await tx
      .select()
      .from(applicationEmails)
      .where(
        and(eq(applicationEmails.id, emailId), eq(applicationEmails.applicationId, applicationId)),
      );
    if (!email) throw notFound(`Email ${emailId} does not exist`);
    if (email.status !== 'NEW')
      throw conflict('already-decided', 'This email was already dealt with');
    return email;
  }
}
