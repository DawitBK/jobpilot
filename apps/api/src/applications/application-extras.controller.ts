import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { DocumentsService } from '../ai/documents.service.js';
import { recordAudit } from '../common/audit.js';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import { organizations } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { EmailsService, logEmailSchema, type LogEmail } from '../emails/emails.service.js';
import { policySettingsSchema, type PolicySettings } from '../policy/policy.js';
import { PolicyService } from '../policy/policy.service.js';
import { ApplicationsService } from './applications.service.js';

const idParams = new ZodValidationPipe(z.object({ id: z.uuid() }));
const emailParams = new ZodValidationPipe(z.object({ id: z.uuid(), emailId: z.uuid() }));
const kindBody = new ZodValidationPipe(
  z.object({ kind: z.enum(['RESUME', 'COVER_LETTER']) }).strict(),
);
const manualBody = new ZodValidationPipe(
  z
    .object({
      kind: z.enum(['RESUME', 'COVER_LETTER']),
      content: z.string().trim().min(20).max(12_000),
    })
    .strict(),
);

/**
 * What hangs off one application: its documents, the employer emails logged against it, and the
 * review the policy engine does before a person approves. Each route first checks the application
 * is visible to the caller (a candidate sees only their own).
 */
@Controller('api/v1/applications/:id')
export class ApplicationExtrasController {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(ApplicationsService) private readonly applications: ApplicationsService,
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(EmailsService) private readonly emails: EmailsService,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  // ---- review: policy tier and the reasons, before approving
  @RequirePermission('applications:read')
  @Get('review')
  review(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.tenant.inTenant(p, async (tx) => {
      const app = await this.applications.mustSee(tx, p, params.id);
      return this.policy.evaluate(tx, app);
    });
  }

  // ---- documents
  @RequirePermission('applications:read')
  @Get('documents')
  async listDocuments(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return { ...(await this.documents.list(p, params.id)), ai: await this.documents.status(p) };
  }

  /** Ask the AI to write a resume or cover letter, then check every sentence against the candidate's record. */
  @RequirePermission('applications:write')
  @Post('documents/generate')
  @HttpCode(201)
  generate(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(kindBody) body: { kind: 'RESUME' | 'COVER_LETTER' },
  ) {
    return this.documents.generate(p, params.id, body.kind);
  }

  @RequirePermission('applications:write')
  @Post('documents/manual')
  @HttpCode(201)
  manual(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(manualBody) body: { kind: 'RESUME' | 'COVER_LETTER'; content: string },
  ) {
    return this.documents.writeManually(p, params.id, body.kind, body.content);
  }

  // ---- employer emails
  @RequirePermission('applications:read')
  @Get('emails')
  listEmails(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.emails.list(p, params.id);
  }

  @RequirePermission('applications:write')
  @Post('emails')
  @HttpCode(201)
  logEmail(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(logEmailSchema)) body: LogEmail,
  ) {
    return this.emails.log(p, params.id, body);
  }

  @RequirePermission('applications:write')
  @Post('emails/:emailId/apply')
  @HttpCode(200)
  applyEmail(
    @CurrentUser() p: Principal,
    @Param(emailParams) params: { id: string; emailId: string },
  ) {
    return this.emails.apply(p, params.id, params.emailId);
  }

  @RequirePermission('applications:write')
  @Post('emails/:emailId/dismiss')
  @HttpCode(200)
  dismissEmail(
    @CurrentUser() p: Principal,
    @Param(emailParams) params: { id: string; emailId: string },
  ) {
    return this.emails.dismiss(p, params.id, params.emailId);
  }
}

/** The organization's review rules. */
@Controller('api/v1/organization/policy')
export class PolicyController {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  @RequirePermission('analytics:read')
  @Get()
  get(@CurrentUser() p: Principal) {
    return this.tenant.inTenant(p, (tx) => this.policy.settingsOf(tx, p.organizationId));
  }

  @RequirePermission('organizations:manage')
  @Put()
  set(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(policySettingsSchema)) body: PolicySettings,
  ) {
    return this.tenant.inTenant(p, async (tx) => {
      const before = await this.policy.settingsOf(tx, p.organizationId);
      await tx
        .update(organizations)
        .set({ policy: body })
        .where(eq(organizations.id, p.organizationId));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'policy.changed',
        resourceType: 'organization',
        resourceId: p.organizationId,
        before,
        after: body,
      });
      return body;
    });
  }
}
