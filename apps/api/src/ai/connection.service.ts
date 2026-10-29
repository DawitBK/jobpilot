import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Post,
  Put,
} from '@nestjs/common';
import { notFound, ProblemException, unprocessable, ZodValidationPipe } from '@jobpilot/kit';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordAudit } from '../common/audit.js';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import type { Tx } from '../db/db.module.js';
import { organizationSecrets } from '../db/schema.js';
import { TenantDb } from '../db/tenant.js';
import { assertPublicHttpsUrl } from '../jobs/feeds.js';
import { SecretsStore } from '../secrets/secrets.module.js';
import {
  AI_PROVIDER_FACTORY,
  AI_SETTINGS,
  AI_VENDORS,
  DEFAULT_BASE_URLS,
  DEFAULT_MODELS,
  type AiConnection,
  type AiProviderFactory,
  type AiSettings,
} from './provider.js';

const SECRET = 'ai_connection' as const;

export const aiConnectionInputSchema = z
  .object({
    vendor: z.enum(AI_VENDORS),
    apiKey: z.string().trim().min(8).max(400),
    model: z.string().trim().min(2).max(120).optional(),
    baseUrl: z
      .url({ protocol: /^https?$/, error: 'must be an absolute http or https URL' })
      .max(300)
      .optional(),
  })
  .strict();
export type AiConnectionInput = z.output<typeof aiConnectionInputSchema>;

export const aiConnectionViewSchema = z.object({
  configured: z.boolean(),
  source: z.enum(['organization', 'server']).nullable(),
  vendor: z.enum(AI_VENDORS).nullable(),
  model: z.string().nullable(),
  baseUrl: z.string().nullable(),
  hint: z
    .string()
    .nullable()
    .describe('The last four characters of the stored key (never the key)'),
});
export type AiConnectionView = z.output<typeof aiConnectionViewSchema>;

export interface Resolved {
  connection: AiConnection;
  source: 'organization' | 'server';
}

/** Which model connection an organization uses: its own when it stored one, otherwise the server's, otherwise none. */
@Injectable()
export class AiConnectionService {
  constructor(
    @Inject(TenantDb) private readonly tenant: TenantDb,
    @Inject(SecretsStore) private readonly secrets: SecretsStore,
    @Inject(AI_SETTINGS) private readonly settings: AiSettings,
    @Inject(AI_PROVIDER_FACTORY) private readonly makeProvider: AiProviderFactory,
  ) {}

  async resolve(tx: Tx, organizationId: string): Promise<Resolved | null> {
    let stored: string | null;
    try {
      stored = await this.secrets.get(tx, organizationId, SECRET);
    } catch {
      throw new ProblemException(
        503,
        'secret-unreadable',
        'The stored AI connection cannot be read',
        'It was made with a key this server no longer has. Save the connection again in Settings.',
      );
    }
    if (stored) return { connection: JSON.parse(stored) as AiConnection, source: 'organization' };
    return this.settings.server ? { connection: this.settings.server, source: 'server' } : null;
  }

  private view(r: Resolved | null, hint: string | null): AiConnectionView {
    return {
      configured: r !== null,
      source: r?.source ?? null,
      vendor: r?.connection.vendor ?? null,
      model: r?.connection.model ?? null,
      baseUrl: r?.connection.baseUrl ?? null,
      hint: r?.source === 'organization' ? hint : null,
    };
  }

  async describe(p: Principal): Promise<AiConnectionView> {
    return this.tenant.inTenant(p, async (tx) => {
      const resolved = await this.resolve(tx, p.organizationId);
      const [row] = await tx
        .select({ hint: organizationSecrets.hint })
        .from(organizationSecrets)
        .where(
          and(
            eq(organizationSecrets.organizationId, p.organizationId),
            eq(organizationSecrets.name, SECRET),
          ),
        );
      return this.view(resolved, row?.hint ?? null);
    });
  }

  async save(p: Principal, input: AiConnectionInput): Promise<AiConnectionView> {
    if (input.vendor === 'custom' && !input.baseUrl) {
      throw unprocessable(
        'base-url-required',
        'A custom provider needs its address',
        'Enter the base address of the chat-completions API.',
      );
    }
    const baseUrl =
      input.vendor === 'anthropic' ? undefined : (input.baseUrl ?? DEFAULT_BASE_URLS[input.vendor]);
    if (input.baseUrl && input.vendor !== 'anthropic' && !this.settings.allowPrivateBaseUrls) {
      // A shared server must not be made to call into its own network on someone's say-so.
      try {
        await assertPublicHttpsUrl(input.baseUrl);
      } catch (error) {
        throw unprocessable(
          'base-url-refused',
          'That address cannot be used',
          (error as Error).message,
        );
      }
    }
    const connection: AiConnection = {
      vendor: input.vendor,
      apiKey: input.apiKey,
      model: input.model ?? DEFAULT_MODELS[input.vendor],
      ...(baseUrl ? { baseUrl } : {}),
    };
    await this.tenant.inTenant(p, async (tx) => {
      await this.secrets.put(tx, p, SECRET, JSON.stringify(connection), input.apiKey.slice(-4));
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'ai.connection_set',
        resourceType: 'secret',
        resourceId: SECRET,
        after: {
          vendor: connection.vendor,
          model: connection.model,
          baseUrl: connection.baseUrl ?? null,
        },
      });
    });
    return this.describe(p);
  }

  async remove(p: Principal): Promise<void> {
    await this.tenant.inTenant(p, async (tx) => {
      const gone = await tx
        .delete(organizationSecrets)
        .where(
          and(
            eq(organizationSecrets.organizationId, p.organizationId),
            eq(organizationSecrets.name, SECRET),
          ),
        )
        .returning({ id: organizationSecrets.id });
      if (gone.length === 0) throw notFound('No AI connection is stored for this organization');
      await recordAudit(tx, {
        organizationId: p.organizationId,
        actorUserId: p.userId,
        actorType: 'USER',
        action: 'ai.connection_removed',
        resourceType: 'secret',
        resourceId: SECRET,
      });
    });
  }

  /** A real, tiny request with whatever connection is in effect: proves the key, the model and the address work. */
  async test(
    p: Principal,
  ): Promise<{ ok: true; vendor: string; model: string; milliseconds: number }> {
    const resolved = await this.tenant.inTenant(p, (tx) => this.resolve(tx, p.organizationId));
    if (!resolved) {
      throw new ProblemException(
        503,
        'ai-not-configured',
        'AI writing is not set up',
        'Save a connection first.',
      );
    }
    const provider = this.makeProvider(resolved.connection);
    const started = Date.now();
    const answer = await provider.complete({
      system: 'Reply with the single word OK.',
      user: 'Ping',
      maxTokens: 64,
    });
    return {
      ok: true,
      vendor: provider.name,
      model: answer.model,
      milliseconds: Date.now() - started,
    };
  }
}

@Controller('api/v1/ai/connection')
export class AiConnectionController {
  constructor(@Inject(AiConnectionService) private readonly service: AiConnectionService) {}

  /** Which model connection is in effect and where it comes from; never the key. */
  @RequirePermission('ai_config:manage')
  @Get()
  get(@CurrentUser() p: Principal) {
    return this.service.describe(p);
  }

  @RequirePermission('ai_config:manage')
  @Put()
  put(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(aiConnectionInputSchema)) body: AiConnectionInput,
  ) {
    return this.service.save(p, body);
  }

  @RequirePermission('ai_config:manage')
  @Delete()
  @HttpCode(204)
  async remove(@CurrentUser() p: Principal) {
    await this.service.remove(p);
  }

  @RequirePermission('ai_config:manage')
  @Post('test')
  @HttpCode(200)
  test(@CurrentUser() p: Principal) {
    return this.service.test(p);
  }
}
