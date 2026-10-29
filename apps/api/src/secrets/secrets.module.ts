import {
  Body,
  Controller,
  Delete,
  Get,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Put,
  type DynamicModule,
} from '@nestjs/common';
import { notFound, ZodValidationPipe } from '@jobpilot/kit';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../common/audit.js';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import type { Tx } from '../db/db.module.js';
import { organizationSecrets } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { SECRET_BOX, SecretBox } from './secret-box.js';

/** The credentials an organization may store. Anything else is refused, so the table cannot become a general vault. */
export const SECRET_NAMES = ['anthropic_api_key'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

const nameParams = z.object({ name: z.enum(SECRET_NAMES) });
export const putSecretSchema = z.object({ value: z.string().trim().min(8).max(500) }).strict();
type PutSecret = z.output<typeof putSecretSchema>;

export const secretInfoSchema = z.object({
  name: z.enum(SECRET_NAMES),
  hint: z.string().describe('The last four characters, so you can tell which key is stored'),
  createdAt: z.iso.datetime(),
  rotatedAt: z.iso.datetime().nullable(),
});

const context = (organizationId: string, name: string) => `org:${organizationId}:${name}`;

@Injectable()
export class SecretsStore {
  constructor(@Inject(SECRET_BOX) readonly box: SecretBox) {}

  /** The plain value, for code that must use it (never for an API response). Null when none is stored. */
  async get(tx: Tx, organizationId: string, name: SecretName): Promise<string | null> {
    const [row] = await tx
      .select()
      .from(organizationSecrets)
      .where(
        and(
          eq(organizationSecrets.organizationId, organizationId),
          eq(organizationSecrets.name, name),
        ),
      );
    return row ? this.box.decrypt(row.ciphertext, context(organizationId, name)) : null;
  }

  async put(tx: Tx, p: Principal, name: SecretName, value: string): Promise<void> {
    const ciphertext = this.box.encrypt(value, context(p.organizationId, name));
    const hint = value.slice(-4);
    await tx
      .insert(organizationSecrets)
      .values({ organizationId: p.organizationId, name, ciphertext, hint, createdBy: p.userId })
      .onConflictDoUpdate({
        target: [organizationSecrets.organizationId, organizationSecrets.name],
        set: { ciphertext, hint, rotatedAt: sql`now()`, createdBy: p.userId },
      });
  }
}

@Controller('api/v1/secrets')
export class SecretsController {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(SecretsStore) private readonly store: SecretsStore,
  ) {}

  /** Which credentials are stored: names and the last four characters, never the values. */
  @RequirePermission('ai_config:manage')
  @Get()
  list(@CurrentUser() p: Principal) {
    return this.tenant.inTenant(p, async (tx) => {
      const rows = await tx.select().from(organizationSecrets);
      return rows.map((r) => ({
        name: r.name,
        hint: r.hint,
        createdAt: r.createdAt.toISOString(),
        rotatedAt: r.rotatedAt?.toISOString() ?? null,
      }));
    });
  }

  @RequirePermission('ai_config:manage')
  @Put(':name')
  @HttpCode(204)
  async put(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(nameParams)) params: { name: SecretName },
    @Body(new ZodValidationPipe(putSecretSchema)) body: PutSecret,
  ) {
    await this.tenant.inTenant(p, async (tx) => {
      await this.store.put(tx, p, params.name, body.value);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'secret.set',
        resourceType: 'secret',
        resourceId: params.name,
      });
    });
  }

  @RequirePermission('ai_config:manage')
  @Delete(':name')
  @HttpCode(204)
  async remove(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(nameParams)) params: { name: SecretName },
  ) {
    await this.tenant.inTenant(p, async (tx) => {
      const gone = await tx
        .delete(organizationSecrets)
        .where(
          and(
            eq(organizationSecrets.organizationId, p.organizationId),
            eq(organizationSecrets.name, params.name),
          ),
        )
        .returning({ id: organizationSecrets.id });
      if (gone.length === 0) throw notFound(`No ${params.name} is stored`);
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'secret.removed',
        resourceType: 'secret',
        resourceId: params.name,
      });
    });
  }
}

@Global()
@Module({})
export class SecretsModule {
  static register(box: SecretBox): DynamicModule {
    return {
      module: SecretsModule,
      controllers: [SecretsController],
      providers: [{ provide: SECRET_BOX, useValue: box }, SecretsStore],
      exports: [SECRET_BOX, SecretsStore],
    };
  }
}
