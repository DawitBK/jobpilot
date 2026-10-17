import { createHash } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import type { Database, Tx } from '../db/db.module.js';
import { auditLogs, outboxEvents, type ActorType } from '../db/schema.js';

const GENESIS = 'GENESIS';

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  actorType: ActorType;
  action: string;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * JSON with object keys sorted, recursively. The audit payloads live in jsonb, which does not keep
 * key order, so the hash has to be taken over a form that does not depend on it.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The exact bytes a row's hash covers: fixed field order, so it can be recomputed later. */
function contentOf(e: AuditEntry, createdAt: string): string {
  return canonical([
    e.organizationId,
    e.actorUserId,
    e.actorType,
    e.action,
    e.resourceType,
    e.resourceId,
    e.before ?? null,
    e.after ?? null,
    createdAt,
  ]);
}

const hashOf = (prev: string, content: string) =>
  createHash('sha256').update(prev).update('|').update(content).digest('hex');

/**
 * Append to the tenant's audit chain. Each row's hash covers the previous row's hash, so editing or
 * removing any past row breaks every hash after it and `verifyAuditChain` shows it. The chain is
 * extended under a per-tenant advisory lock, so concurrent writers cannot fork it.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'audit:' + entry.organizationId}))`);
  const [last] = await tx
    .select({ selfHash: auditLogs.selfHash })
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, entry.organizationId))
    .orderBy(sql`${auditLogs.id} desc`)
    .limit(1);
  const prevHash = last?.selfHash ?? GENESIS;
  const createdAt = new Date().toISOString();
  await tx.insert(auditLogs).values({
    organizationId: entry.organizationId,
    actorUserId: entry.actorUserId,
    actorType: entry.actorType,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    prevHash,
    selfHash: hashOf(prevHash, contentOf(entry, createdAt)),
    createdAt: new Date(createdAt),
  });
}

/** Recompute the whole chain for a tenant. `brokenAt` is the first row whose hash does not hold. */
export async function verifyAuditChain(
  db: Pick<Database, 'select'>,
  organizationId: string,
): Promise<{ valid: boolean; checked: number; brokenAt: number | null }> {
  const rows = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(asc(auditLogs.id));
  let prev = GENESIS;
  for (const r of rows) {
    const content = contentOf(
      {
        organizationId: r.organizationId,
        actorUserId: r.actorUserId,
        actorType: r.actorType,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        before: r.before,
        after: r.after,
      },
      r.createdAt.toISOString(),
    );
    if (r.prevHash !== prev || r.selfHash !== hashOf(prev, content)) {
      return { valid: false, checked: rows.length, brokenAt: r.id };
    }
    prev = r.selfHash;
  }
  return { valid: true, checked: rows.length, brokenAt: null };
}

/** Announce a change for asynchronous consumers, in the same transaction as the change itself. */
export async function enqueue(
  tx: Tx,
  organizationId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(outboxEvents).values({ organizationId, eventType, payload });
}
