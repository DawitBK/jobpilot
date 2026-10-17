import { Controller, Get, Inject, Query } from '@nestjs/common';
import { toPage, paginationQuerySchema, ZodValidationPipe, type Pagination } from '@jobpilot/kit';
import { count, desc, eq } from 'drizzle-orm';
import { verifyAuditChain } from '../common/audit.js';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import { auditLogs } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';

@Controller('api/v1/audit')
export class AuditController {
  constructor(@Inject(TenantDb) private readonly tenant: TenantDb) {}

  /** The organization's audit trail, newest first. */
  @RequirePermission('audit:read')
  @Get()
  list(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(paginationQuerySchema)) page: Pagination,
  ) {
    return this.tenant.inTenant(p, async (tx) => {
      const [rows, totals] = await Promise.all([
        tx
          .select({
            id: auditLogs.id,
            actorUserId: auditLogs.actorUserId,
            actorType: auditLogs.actorType,
            action: auditLogs.action,
            resourceType: auditLogs.resourceType,
            resourceId: auditLogs.resourceId,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, p.organizationId))
          .orderBy(desc(auditLogs.id))
          .limit(page.limit)
          .offset(page.offset),
        tx
          .select({ total: count() })
          .from(auditLogs)
          .where(eq(auditLogs.organizationId, p.organizationId)),
      ]);
      return toPage(
        rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        totals[0]?.total ?? 0,
        page,
      );
    });
  }

  /** Recompute the hash chain: proves no row was edited or removed. */
  @RequirePermission('audit:read')
  @Get('verify')
  verify(@CurrentUser() p: Principal) {
    return this.tenant.inTenant(p, (tx) => verifyAuditChain(tx, p.organizationId));
  }
}
