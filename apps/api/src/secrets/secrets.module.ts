import { Global, Inject, Injectable, Module, type DynamicModule } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Principal } from '../common/auth.js';
import type { Tx } from '../db/db.module.js';
import { organizationSecrets } from '../db/schema.js';
import { SECRET_BOX, SecretBox } from './secret-box.js';

/**
 * The credentials an organization may store. Anything else is refused, so the table cannot become a general
 * vault. Each is written and read only by the feature that owns it (for example `ai_connection` by the AI
 * settings); there is no route that returns a stored value.
 */
export const SECRET_NAMES = ['ai_connection'] as const;
export type SecretName = (typeof SECRET_NAMES)[number];

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

  /** `hint` is what may be shown about the value afterwards (the last four characters of a key). */
  async put(tx: Tx, p: Principal, name: SecretName, value: string, hint: string): Promise<void> {
    const ciphertext = this.box.encrypt(value, context(p.organizationId, name));
    await tx
      .insert(organizationSecrets)
      .values({ organizationId: p.organizationId, name, ciphertext, hint, createdBy: p.userId })
      .onConflictDoUpdate({
        target: [organizationSecrets.organizationId, organizationSecrets.name],
        set: { ciphertext, hint, rotatedAt: sql`now()`, createdBy: p.userId },
      });
  }
}

@Global()
@Module({})
export class SecretsModule {
  static register(box: SecretBox): DynamicModule {
    return {
      module: SecretsModule,
      providers: [{ provide: SECRET_BOX, useValue: box }, SecretsStore],
      exports: [SECRET_BOX, SecretsStore],
    };
  }
}
