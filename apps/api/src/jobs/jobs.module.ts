import { Module, type DynamicModule } from '@nestjs/common';
import { ApplicationsController } from '../applications/applications.controller.js';
import { ApplicationsService } from '../applications/applications.service.js';
import { CandidatesController } from '../candidates/candidates.controller.js';
import { CandidatesService } from '../candidates/candidates.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { HttpJobFeedFetcher, JOB_FEED_FETCHER, type JobFeedFetcher } from './feeds.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

/**
 * Candidates, jobs, matching and applications are one module: they share the matching and
 * lifecycle code, and a job, a candidate and an application only make sense together.
 */
@Module({})
export class JobsModule {
  /** Pass a fetcher to replace real network access (the integration tests do). */
  static register(fetcher?: JobFeedFetcher): DynamicModule {
    return {
      module: JobsModule,
      controllers: [JobsController, CandidatesController, ApplicationsController],
      providers: [
        JobsService,
        CandidatesService,
        ApplicationsService,
        MatchingService,
        { provide: JOB_FEED_FETCHER, useValue: fetcher ?? new HttpJobFeedFetcher() },
      ],
    };
  }
}
