import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { JobsService } from './jobs.service.js';

export const SOURCES_OPTIONS = 'SOURCES_OPTIONS';
export interface SourcesOptions {
  /** How often to look for sources that are due, in milliseconds; 0 turns the schedule off (tests call `tick`). */
  pollMs: number;
}

/** A claimed source is left alone this long, so a crash cannot make it be read over and over, nor two servers read it at once. */
const LEASE_MINUTES = 10;
const BATCH = 5;

interface Due {
  id: string;
  organization_id: string;
}

/**
 * Reads job sources on their own schedule. Like the outbox, it gets one narrow door past tenant
 * isolation (`app.dispatcher`, migration 0008): it may find which sources are due, in any
 * organization, and claim them. The reading itself then happens inside that source's own
 * organization, exactly like a request.
 */
@Injectable()
export class SourceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Sources');
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SOURCES_OPTIONS) private readonly options: SourcesOptions,
    @Inject(JobsService) private readonly jobs: JobsService,
  ) {}

  onModuleInit(): void {
    if (this.options.pollMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.options.pollMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: read every source that is due. Returns how many were read (failed reads count: they back off). */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let total = 0;
      for (;;) {
        const due = await this.claim();
        for (const source of due) {
          try {
            await this.jobs.execute(
              { organizationId: source.organization_id, userId: null },
              source.id,
              'SCHEDULE',
            );
          } catch (error) {
            // The failure and its back-off are already recorded by the read itself.
            this.logger.warn(`Source ${source.id}: ${(error as Error).message}`);
          }
        }
        total += due.length;
        if (due.length < BATCH) break;
      }
      return total;
    } catch (error) {
      this.logger.error(`Source pass failed: ${(error as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Mark the due sources as taken for a while and return them. Other servers skip rows that are locked. */
  private async claim(): Promise<Due[]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.dispatcher', 'on', true)`);
      const result = await tx.execute(sql`
        update job_sources set next_run_at = now() + make_interval(mins => ${LEASE_MINUTES})
        where id in (
          select id from job_sources
          where enabled and (next_run_at is null or next_run_at <= now())
          order by next_run_at asc nulls first
          limit ${BATCH}
          for update skip locked
        )
        returning id, organization_id`);
      return result.rows as unknown as Due[];
    });
  }
}
