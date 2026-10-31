import { Module, type DynamicModule } from '@nestjs/common';
import {
  buildProvider,
  AI_PROVIDER_FACTORY,
  AI_SETTINGS,
  type AiProviderFactory,
  type AiSettings,
} from '../ai/provider.js';
import { AiConnectionController, AiConnectionService } from '../ai/connection.service.js';
import { DocumentsService } from '../ai/documents.service.js';
import {
  ApplicationExtrasController,
  PolicyController,
} from '../applications/application-extras.controller.js';
import { ApplicationsController } from '../applications/applications.controller.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { CandidatesController } from '../candidates/candidates.controller.js';
import { CandidatesService } from '../candidates/candidates.service.js';
import { EmailsService } from '../emails/emails.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { PolicyService } from '../policy/policy.service.js';
import { HttpJobFeedFetcher, JOB_FEED_FETCHER, type JobFeedFetcher } from './feeds.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';
import { SOURCES_OPTIONS, SourceScheduler, type SourcesOptions } from './sources.scheduler.js';

/**
 * Candidates, jobs, matching and applications are one module: they share the matching and
 * lifecycle code, and a job, a candidate and an application only make sense together.
 */
@Module({})
export class JobsModule {
  /** Pass a fetcher to replace real network access (the integration tests do). */
  static register(
    fetcher: JobFeedFetcher | undefined,
    ai: { settings: AiSettings; factory?: AiProviderFactory },
    sources: SourcesOptions = { pollMs: 0 },
  ): DynamicModule {
    return {
      module: JobsModule,
      controllers: [
        JobsController,
        CandidatesController,
        ApplicationsController,
        ApplicationExtrasController,
        PolicyController,
        AiConnectionController,
      ],
      providers: [
        JobsService,
        SourceScheduler,
        { provide: SOURCES_OPTIONS, useValue: sources },
        CandidatesService,
        ApplicationsService,
        MatchingService,
        PolicyService,
        DocumentsService,
        EmailsService,
        { provide: AI_SETTINGS, useValue: ai.settings },
        {
          provide: AI_PROVIDER_FACTORY,
          useValue: ai.factory ?? buildProvider,
        },
        AiConnectionService,
        { provide: JOB_FEED_FETCHER, useValue: fetcher ?? new HttpJobFeedFetcher() },
      ],
    };
  }
}
