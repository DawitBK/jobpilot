import { Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import {
  notFound,
  pageSchema,
  paginationQuerySchema,
  toPage,
  ZodValidationPipe,
} from '@jobpilot/kit';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CurrentUser, type Principal } from '../common/auth.js';
import { NOTIFICATION_KINDS, notifications } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { idParamsSchema } from '../jobs/jobs.contract.js';

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  read: z.boolean(),
  emailStatus: z.enum(['NOT_SENT', 'SENT', 'FAILED', 'SKIPPED']),
  createdAt: z.iso.datetime(),
});
export const notificationPageSchema = pageSchema(notificationSchema);

export const listNotificationsQuerySchema = paginationQuerySchema.extend({
  unread: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => v === 'true' || v === '1'),
});
type ListNotificationsQuery = z.output<typeof listNotificationsQuerySchema>;

/** A person's own notifications in the organization they are signed in to; nobody else's, whatever their role. */
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(@Inject(TenantDb) private readonly tenant: TenantDb) {}

  @Get()
  list(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ) {
    return this.tenant.inTenant(p, async (tx) => {
      const where = and(
        eq(notifications.userId, p.userId),
        query.unread ? isNull(notifications.readAt) : undefined,
      );
      const [rows, totals] = await Promise.all([
        tx
          .select()
          .from(notifications)
          .where(where)
          .orderBy(desc(notifications.createdAt), desc(notifications.id))
          .limit(query.limit)
          .offset(query.offset),
        tx.select({ total: count() }).from(notifications).where(where),
      ]);
      return toPage(
        rows.map((n) => ({
          id: n.id,
          kind: n.kind,
          title: n.title,
          body: n.body,
          link: n.link,
          read: n.readAt !== null,
          emailStatus: n.emailStatus,
          createdAt: n.createdAt.toISOString(),
        })),
        totals[0]?.total ?? 0,
        query,
      );
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() p: Principal) {
    const rows = await this.tenant.inTenant(p, (tx) =>
      tx
        .select({ total: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt))),
    );
    return { count: rows[0]?.total ?? 0 };
  }

  @Post('read-all')
  async readAll(@CurrentUser() p: Principal) {
    const updated = await this.tenant.inTenant(p, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(and(eq(notifications.userId, p.userId), isNull(notifications.readAt)))
        .returning({ id: notifications.id }),
    );
    return { updated: updated.length };
  }

  @Post(':id/read')
  @HttpCode(204)
  async read(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(idParamsSchema)) params: { id: string },
  ) {
    const updated = await this.tenant.inTenant(p, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, params.id), eq(notifications.userId, p.userId)))
        .returning({ id: notifications.id }),
    );
    if (updated.length === 0) throw notFound(`Notification ${params.id} does not exist`);
  }
}
