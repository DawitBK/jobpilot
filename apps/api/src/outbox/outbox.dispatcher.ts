import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DB, type Database, type Tx } from '../db/db.module.js';
import {
  applications,
  candidateProfiles,
  companies,
  jobMatches,
  jobSources,
  jobs,
  notifications,
  organizationMembers,
  organizations,
  outboxEvents,
  roles,
  users,
  type ApplicationState,
} from '../db/schema.js';
import { MAILER, type Mailer } from './mailer.js';
import { applicationDraft, type Draft } from './messages.js';

export const OUTBOX_OPTIONS = 'JOBPILOT_OUTBOX_OPTIONS';

export interface OutboxOptions {
  /** How often the dispatcher looks for new events; 0 turns the background loop off (tests call `dispatchOnce`). */
  pollMs: number;
  /** The public address of the web app, used for the links in emails. */
  appUrl: string;
  batchSize?: number;
  maxAttempts?: number;
}

type EventRow = typeof outboxEvents.$inferSelect;

interface PendingMail {
  notificationId: string;
  organizationId: string;
  to: string;
  subject: string;
  text: string;
}

/** Roles that look after other people's applications and sources: they hear about reviews and discoveries too. */
const MANAGING_ROLES = ['OWNER', 'ADMIN', 'RECRUITER'] as const;

const asState = (value: unknown): ApplicationState | null =>
  typeof value === 'string' ? (value as ApplicationState) : null;

/**
 * Turns the transactional outbox into effects. Events are claimed with `FOR UPDATE SKIP LOCKED`, so
 * several API instances can run it at once without handling an event twice. Each event is handled in
 * its own savepoint and inside ITS tenant (`app.organization_id`), exactly like a request: the one
 * thing the dispatcher may do outside a tenant is read and mark outbox rows (migration 0004).
 * A failing event is retried with a growing delay and, after the last attempt, kept as FAILED with
 * the reason, so nothing disappears silently.
 */
@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Outbox');
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(OUTBOX_OPTIONS) private readonly options: OutboxOptions,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  onModuleInit(): void {
    if (this.options.pollMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.options.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the pending events, then the emails they asked for. Returns how many events were handled. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let total = 0;
      const batch = this.options.batchSize ?? 50;
      for (;;) {
        const handled = await this.dispatchOnce();
        total += handled;
        if (handled < batch) break;
      }
      return total;
    } catch (error) {
      this.logger.error(`Dispatch pass failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  async dispatchOnce(): Promise<number> {
    const batch = this.options.batchSize ?? 50;
    const maxAttempts = this.options.maxAttempts ?? 5;
    const mails: PendingMail[] = [];
    const handled = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.dispatcher', 'on', true)`);
      const events = await tx
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.status, 'PENDING'), lte(outboxEvents.nextAttemptAt, sql`now()`)))
        .orderBy(asc(outboxEvents.id))
        .limit(batch)
        .for('update', { skipLocked: true });
      for (const event of events) {
        try {
          const produced = await tx.transaction(async (sp) => {
            await sp.execute(
              sql`select set_config('app.organization_id', ${event.organizationId}, true)`,
            );
            return this.handle(sp, event);
          });
          mails.push(...produced);
          await tx
            .update(outboxEvents)
            .set({ status: 'DISPATCHED', dispatchedAt: sql`now()`, lastError: null })
            .where(eq(outboxEvents.id, event.id));
        } catch (error) {
          const attempts = event.attempts + 1;
          const message = (error as Error).message.slice(0, 500);
          this.logger.warn(
            `Event ${event.id} (${event.eventType}) failed, attempt ${attempts}: ${message}`,
          );
          await tx
            .update(outboxEvents)
            .set({
              attempts,
              lastError: message,
              status: attempts >= maxAttempts ? 'FAILED' : 'PENDING',
              // 5 s, 20 s, 80 s, 5 min ... capped at 15 minutes
              nextAttemptAt: sql`now() + make_interval(secs => ${Math.min(5 * 4 ** (attempts - 1), 900)})`,
            })
            .where(eq(outboxEvents.id, event.id));
        }
      }
      return events.length;
    });
    await this.sendMails(mails);
    return handled;
  }

  /** Emails go out after the database work has committed, and each one records its own result. */
  private async sendMails(mails: PendingMail[]): Promise<void> {
    for (const mail of mails) {
      let status: 'SENT' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
      if (this.mailer.configured) {
        try {
          await this.mailer.send({ to: mail.to, subject: mail.subject, text: mail.text });
          status = 'SENT';
        } catch (error) {
          status = 'FAILED';
          this.logger.warn(`Email to a member failed: ${(error as Error).message}`);
        }
      }
      await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.organization_id', ${mail.organizationId}, true)`,
        );
        await tx
          .update(notifications)
          .set({ emailStatus: status })
          .where(eq(notifications.id, mail.notificationId));
      });
    }
  }

  // ------------------------------------------------------------------ what each event does

  private async handle(tx: Tx, event: EventRow): Promise<PendingMail[]> {
    const payload = event.payload as Record<string, unknown>;
    const org = event.organizationId;

    if (event.eventType === 'organization.created') {
      const [row] = await tx
        .select({ owner: organizations.ownerUserId, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, org));
      if (!row) return [];
      return this.notify(tx, event, [row.owner], {
        kind: 'WELCOME',
        title: `Welcome to ${row.name}`,
        body: 'Start with your profile, then add a job or a job source. JobPilot never applies without you.',
        link: '/profile',
        email: false,
      });
    }

    if (event.eventType === 'jobs.discovered') {
      const created = Number(payload['created'] ?? 0);
      const sourceId = String(payload['sourceId'] ?? '');
      const [source] = await tx
        .select({ name: jobSources.name })
        .from(jobSources)
        .where(eq(jobSources.id, sourceId));
      const recipients = await this.members(tx, org, MANAGING_ROLES);
      return this.notify(tx, event, recipients, {
        kind: 'JOBS_FOUND',
        title: `${created} new job${created === 1 ? '' : 's'} from ${source?.name ?? 'a source'}`,
        body: 'They have been scored against the candidate profiles.',
        link: '/jobs',
        email: false,
      });
    }

    if (event.eventType === 'security.mfa') {
      const enabled = payload['enabled'] === true;
      return this.notify(tx, event, [String(payload['userId'])], {
        kind: 'SECURITY',
        title: enabled ? 'Two-step sign-in was turned on' : 'Two-step sign-in was turned off',
        body: enabled
          ? 'From now on, signing in needs a code from your authenticator app. Keep your recovery codes somewhere safe.'
          : 'Signing in now needs only your password. If this was not you, change your password and turn it back on.',
        link: '/security',
        email: true,
      });
    }

    if (event.eventType === 'quota.reached' || event.eventType === 'plan.changed') {
      const recipients = await this.members(tx, org, ['OWNER', 'ADMIN']);
      const draft: Draft =
        event.eventType === 'plan.changed'
          ? {
              kind: 'PLAN',
              title: `The plan changed to ${String(payload['to'])}`,
              body: `It was ${String(payload['from'])}. The new limits apply now.`,
              link: '/billing',
              email: false,
            }
          : {
              kind: 'PLAN',
              title: 'Your plan limit was reached',
              body: `${Number(payload['held'] ?? 0)} application${Number(payload['held'] ?? 0) === 1 ? ' was' : 's were'} not opened because this month's limit is used up. The matches are saved. Change the plan to open them.`,
              link: '/billing',
              email: true,
            };
      return this.notify(tx, event, recipients, draft);
    }

    if (event.eventType.startsWith('application.') && payload['applicationId']) {
      const to = asState(payload['to']);
      if (!to) return [];
      const facts = await this.applicationFacts(tx, String(payload['applicationId']));
      if (!facts) return [];
      const draft = applicationDraft(to, asState(payload['from']), {
        applicationId: String(payload['applicationId']),
        jobTitle: facts.jobTitle,
        companyName: facts.companyName,
        score: facts.score,
        recommendation: facts.recommendation,
      });
      if (!draft) return [];
      const recipients = new Set<string>([facts.candidateUserId]);
      if (draft.kind === 'APPROVAL_NEEDED' || draft.kind === 'NEEDS_REVIEW') {
        for (const id of await this.members(tx, org, MANAGING_ROLES)) recipients.add(id);
      }
      return this.notify(tx, event, [...recipients], draft);
    }

    // candidate.updated, job.created, application.discovered, application.shortlisted, ...: recorded, nobody to tell.
    return [];
  }

  private async applicationFacts(tx: Tx, applicationId: string) {
    const [row] = await tx
      .select({
        candidateUserId: candidateProfiles.userId,
        jobTitle: jobs.title,
        companyName: companies.name,
        score: jobMatches.overallScore,
        recommendation: jobMatches.recommendation,
      })
      .from(applications)
      .innerJoin(candidateProfiles, eq(candidateProfiles.id, applications.candidateProfileId))
      .innerJoin(jobs, eq(jobs.id, applications.jobId))
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(
        jobMatches,
        and(
          eq(jobMatches.candidateProfileId, applications.candidateProfileId),
          eq(jobMatches.jobId, applications.jobId),
        ),
      )
      .where(eq(applications.id, applicationId));
    return row ? { ...row, score: row.score === null ? null : Number(row.score) } : undefined;
  }

  private async members(
    tx: Tx,
    organizationId: string,
    roleNames: readonly string[],
  ): Promise<string[]> {
    const rows = await tx
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .innerJoin(roles, eq(roles.id, organizationMembers.roleId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.status, 'ACTIVE'),
          inArray(roles.name, roleNames as never),
        ),
      );
    return rows.map((r) => r.userId);
  }

  /** One notification per recipient who is still an active member; never twice for the same event. */
  private async notify(
    tx: Tx,
    event: EventRow,
    userIds: string[],
    draft: Draft,
  ): Promise<PendingMail[]> {
    const mails: PendingMail[] = [];
    if (userIds.length === 0) return mails;
    const active = await tx
      .select({ userId: organizationMembers.userId, email: users.email })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, event.organizationId),
          eq(organizationMembers.status, 'ACTIVE'),
          inArray(organizationMembers.userId, userIds),
        ),
      );
    for (const person of active) {
      const [created] = await tx
        .insert(notifications)
        .values({
          organizationId: event.organizationId,
          userId: person.userId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          link: draft.link,
          eventId: event.id,
          emailStatus: draft.email ? 'NOT_SENT' : 'SKIPPED',
        })
        .onConflictDoNothing()
        .returning({ id: notifications.id });
      if (created && draft.email) {
        const link = draft.link ? `${this.options.appUrl.replace(/\/+$/, '')}${draft.link}` : '';
        mails.push({
          notificationId: created.id,
          organizationId: event.organizationId,
          to: person.email,
          subject: draft.title,
          text: `${draft.body}\n\n${link}`.trim(),
        });
      }
    }
    return mails;
  }
}
