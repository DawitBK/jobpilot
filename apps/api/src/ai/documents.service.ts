import { Inject, Injectable } from '@nestjs/common';
import { conflict, notFound, ProblemException } from '@jobpilot/kit';
import { and, desc, eq } from 'drizzle-orm';
import { transition } from '../applications/lifecycle.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { assertWithinQuota } from '../billing/quota.js';
import { CandidatesService } from '../candidates/candidates.service.js';
import { recordAudit } from '../common/audit.js';
import type { Principal } from '../common/auth.js';
import type { Tx } from '../db/db.module.js';
import {
  applicationDocuments,
  applications,
  companies,
  jobs,
  type ApplicationState,
} from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { AiConnectionService } from './connection.service.js';
import {
  buildFacts,
  findInjectionAttempts,
  redactPii,
  restorePii,
  tallyVerdicts,
  verifyClaims,
  type CandidateRecord,
} from './evidence.js';
import {
  claimsFor,
  buildUserPrompt,
  parseModelOutput,
  SYSTEM_PROMPT,
  type DocumentKind,
  type JobForPrompt,
} from './prompt.js';
import { AI_PROVIDER_FACTORY, type AiProvider, type AiProviderFactory } from './provider.js';

/** Where in the pipeline each kind of document may be written. */
const WRITABLE: Record<DocumentKind, ApplicationState[]> = {
  RESUME: ['SHORTLISTED', 'RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'NEEDS_HUMAN_REVIEW'],
  COVER_LETTER: ['RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'NEEDS_HUMAN_REVIEW'],
};
const ADVANCES: Partial<Record<DocumentKind, { from: ApplicationState; to: ApplicationState }>> = {
  RESUME: { from: 'SHORTLISTED', to: 'RESUME_GENERATED' },
  COVER_LETTER: { from: 'RESUME_GENERATED', to: 'COVER_LETTER_GENERATED' },
};

export interface DocumentDto {
  id: string;
  kind: DocumentKind;
  version: number;
  content: string;
  claims: unknown[];
  verdicts: Record<string, number>;
  provider: string;
  model: string;
  redactions: number;
  needsReview: boolean;
  createdAt: string;
}

const toDto = (d: typeof applicationDocuments.$inferSelect): DocumentDto => ({
  id: d.id,
  kind: d.kind,
  version: d.version,
  content: d.content,
  claims: d.claims,
  verdicts: d.verdicts,
  provider: d.provider,
  model: d.model,
  redactions: d.redactions,
  needsReview: d.needsReview,
  createdAt: d.createdAt.toISOString(),
});

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(CandidatesService) private readonly candidates: CandidatesService,
    @Inject(AiConnectionService) private readonly connections: AiConnectionService,
    @Inject(AI_PROVIDER_FACTORY) private readonly makeProvider: AiProviderFactory,
  ) {}

  /** Whether AI writing is available to this organization, from where, and with which vendor and model (never the key). */
  async status(p: Principal): Promise<{
    available: boolean;
    source: 'organization' | 'server' | null;
    vendor: string | null;
    model: string | null;
  }> {
    const resolved = await this.tenant.inTenant(p, (tx) =>
      this.connections.resolve(tx, p.organizationId).catch(() => null),
    );
    return {
      available: resolved !== null,
      source: resolved?.source ?? null,
      vendor: resolved?.connection.vendor ?? null,
      model: resolved?.connection.model ?? null,
    };
  }

  async list(
    p: Principal,
    applicationId: string,
  ): Promise<{ latest: DocumentDto[]; history: Omit<DocumentDto, 'content' | 'claims'>[] }> {
    return this.tenant.inTenant(p, async (tx) => {
      await this.applications.mustSee(tx, p, applicationId);
      const rows = await tx
        .select()
        .from(applicationDocuments)
        .where(eq(applicationDocuments.applicationId, applicationId))
        .orderBy(desc(applicationDocuments.version), desc(applicationDocuments.createdAt));
      const seen = new Set<string>();
      const latest = rows.filter((d) => (seen.has(d.kind) ? false : (seen.add(d.kind), true)));
      return {
        latest: latest.map(toDto),
        history: rows.map((d) => ({
          id: d.id,
          kind: d.kind,
          version: d.version,
          verdicts: d.verdicts,
          provider: d.provider,
          model: d.model,
          redactions: d.redactions,
          needsReview: d.needsReview,
          createdAt: d.createdAt.toISOString(),
        })),
      };
    });
  }

  /** A person writes (or pastes) the document themselves: kept as a version, no AI, nothing to verify. */
  async writeManually(
    p: Principal,
    applicationId: string,
    kind: DocumentKind,
    content: string,
  ): Promise<DocumentDto> {
    return this.tenant.inTenant(p, async (tx) => {
      const app = await this.applications.mustSee(tx, p, applicationId);
      const version = await this.nextVersion(tx, applicationId, kind);
      const [row] = await tx
        .insert(applicationDocuments)
        .values({
          organizationId: p.organizationId,
          applicationId,
          kind,
          version,
          content,
          provider: 'manual',
          model: 'person',
          createdBy: p.userId,
        })
        .returning();
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'document.written',
        resourceType: 'application',
        resourceId: app.id,
        after: { kind, version },
      });
      return toDto(row!);
    });
  }

  async generate(p: Principal, applicationId: string, kind: DocumentKind): Promise<DocumentDto> {
    // 1. Read what is needed and check the plan, then let go of the database before the model is asked.
    const prepared = await this.tenant.inTenant(p, async (tx) => {
      const app = await this.applications.mustSee(tx, p, applicationId);
      if (!WRITABLE[kind].includes(app.state)) {
        throw conflict(
          'wrong-state-for-document',
          `A ${kind === 'RESUME' ? 'resume' : 'cover letter'} cannot be written while the application is ${app.state}`,
          `It can be written when the application is ${WRITABLE[kind].join(', ')}.`,
        );
      }
      if (kind === 'COVER_LETTER') {
        const [resume] = await tx
          .select({ id: applicationDocuments.id })
          .from(applicationDocuments)
          .where(
            and(
              eq(applicationDocuments.applicationId, applicationId),
              eq(applicationDocuments.kind, 'RESUME'),
            ),
          )
          .limit(1);
        if (!resume)
          throw conflict(
            'resume-first',
            'Write the resume first',
            'The cover letter builds on it.',
          );
      }
      const provider = await this.providerFor(tx, p.organizationId);
      await assertWithinQuota(tx, p.organizationId, 'aiGenerations');
      const record = (await this.candidates.read(
        tx,
        app.candidateProfileId,
      )) as unknown as CandidateRecord;
      const [job] = await tx
        .select({
          title: jobs.title,
          description: jobs.description,
          requiredSkills: jobs.requiredSkills,
          company: companies.name,
        })
        .from(jobs)
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .where(eq(jobs.id, app.jobId));
      if (!job) throw notFound('The job for this application no longer exists');
      return {
        app,
        provider,
        record,
        job: {
          title: job.title,
          companyName: job.company,
          description: job.description,
          requiredSkills: job.requiredSkills,
        } satisfies JobForPrompt,
      };
    });

    // 2. Ask the model. Personal details are masked on the way out and restored on the way back.
    const facts = buildFacts(prepared.record);
    const redacted = redactPii(buildUserPrompt(kind, facts, prepared.job));
    const injection = findInjectionAttempts(
      prepared.job.description,
      prepared.job.title,
      prepared.record.summary,
      ...prepared.record.experience.map((e) => e.description),
      ...prepared.record.projects.map((x) => x.description),
    );
    const answer = await prepared.provider.complete({
      system: SYSTEM_PROMPT,
      user: redacted.text,
      maxTokens: 2000,
    });
    const output = parseModelOutput(restorePii(answer.text, redacted.map));

    // 3. Check every sentence against the record, then save the result and move the application along.
    const checked = verifyClaims(claimsFor(output.content, output.claims), facts, prepared.record, [
      prepared.job.companyName,
      prepared.job.title,
    ]);
    const verdicts = tallyVerdicts(checked);
    if (injection.length > 0) verdicts['SUSPECTED_INJECTION'] = injection.length;
    const needsReview =
      (verdicts['UNSUPPORTED'] ?? 0) + (verdicts['CONFLICTING'] ?? 0) + injection.length > 0;
    const content = this.assemble(kind, prepared.record, prepared.job, output.content);

    return this.tenant.inTenant(p, async (tx) => {
      const version = await this.nextVersion(tx, applicationId, kind);
      const [row] = await tx
        .insert(applicationDocuments)
        .values({
          organizationId: p.organizationId,
          applicationId,
          kind,
          version,
          content,
          claims: checked,
          verdicts,
          provider: prepared.provider.name,
          model: answer.model,
          redactions: redacted.count,
          needsReview,
          createdBy: p.userId,
        })
        .returning();
      await assertWithinQuota(tx, p.organizationId, 'aiGenerations', true);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'AI_AGENT',
        action: 'document.generated',
        resourceType: 'application',
        resourceId: applicationId,
        after: {
          kind,
          version,
          provider: prepared.provider.name,
          model: answer.model,
          verdicts,
          redactions: redacted.count,
          injection,
        },
      });
      await this.advance(tx, p, applicationId, kind, needsReview, { verdicts, injection });
      return toDto(row!);
    });
  }

  // ------------------------------------------------------------------ helpers

  /** The organization's own connection first, then the server's; none at all is a plain, honest 503. */
  private async providerFor(tx: Tx, organizationId: string): Promise<AiProvider> {
    const resolved = await this.connections.resolve(tx, organizationId);
    if (!resolved) {
      throw new ProblemException(
        503,
        'ai-not-configured',
        'AI writing is not set up',
        'No AI connection is saved for this organization and the server has no default. An administrator can add one in Settings; you can write the document yourself in the meantime.',
      );
    }
    return this.makeProvider(resolved.connection);
  }

  private async nextVersion(tx: Tx, applicationId: string, kind: DocumentKind): Promise<number> {
    const [last] = await tx
      .select({ version: applicationDocuments.version })
      .from(applicationDocuments)
      .where(
        and(
          eq(applicationDocuments.applicationId, applicationId),
          eq(applicationDocuments.kind, kind),
        ),
      )
      .orderBy(desc(applicationDocuments.version))
      .limit(1);
    return (last?.version ?? 0) + 1;
  }

  private assemble(
    kind: DocumentKind,
    record: CandidateRecord,
    job: JobForPrompt,
    body: string,
  ): string {
    if (kind === 'RESUME') {
      return [record.fullName, record.headline ?? '', '', body.trim()]
        .filter((line, i) => i !== 1 || line)
        .join('\n');
    }
    return `Dear hiring team at ${job.companyName},\n\n${body.trim()}\n\nSincerely,\n${record.fullName}`;
  }

  /** The AI moves an application along the pipeline, never to approval; a flagged document stops it for a person. */
  private async advance(
    tx: Tx,
    p: Principal,
    applicationId: string,
    kind: DocumentKind,
    needsReview: boolean,
    detail: Record<string, unknown>,
  ): Promise<void> {
    // The state may have moved while the model was thinking: read it again; `transition` locks the row.
    const [app] = await tx
      .select({ state: applications.state })
      .from(applications)
      .where(eq(applications.id, applicationId));
    let state = app?.state;
    const step = ADVANCES[kind];
    const actor = { type: 'AI_AGENT' as const, userId: null };
    if (step && state === step.from) {
      await transition(tx, p.organizationId, applicationId, step.to, {
        actor,
        eventType: `document.${kind.toLowerCase()}.generated`,
        payload: { requestedBy: p.userId, ...detail },
      });
      state = step.to;
    }
    if (needsReview && (state === 'RESUME_GENERATED' || state === 'COVER_LETTER_GENERATED')) {
      await transition(tx, p.organizationId, applicationId, 'NEEDS_HUMAN_REVIEW', {
        actor,
        eventType: 'document.needs-review',
        payload: {
          reason:
            'Statements that the candidate record does not support, or instructions hidden in the posting',
          ...detail,
        },
      });
    }
  }
}
