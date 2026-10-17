import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import {
  createJobSchema,
  createSourceSchema,
  idParamsSchema,
  listJobsQuerySchema,
  listMatchesQuerySchema,
  rescoreSchema,
  updateJobSchema,
  updateSourceSchema,
  type CreateJob,
  type CreateSource,
  type ListJobsQuery,
  type ListMatchesQuery,
  type UpdateJob,
  type UpdateSource,
} from './jobs.contract.js';
import { JobsService } from './jobs.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);

@Controller('api/v1')
export class JobsController {
  constructor(@Inject(JobsService) private readonly jobs: JobsService) {}

  // ---- jobs ----

  @RequirePermission('jobs:write')
  @Post('jobs')
  createJob(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(createJobSchema)) body: CreateJob,
  ) {
    return this.jobs.createJob(p, body);
  }

  @RequirePermission('jobs:read')
  @Get('jobs')
  listJobs(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(listJobsQuerySchema)) q: ListJobsQuery,
  ) {
    return this.jobs.listJobs(p, q);
  }

  @RequirePermission('jobs:read')
  @Get('jobs/:id')
  getJob(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.jobs.getJob(p, params.id);
  }

  @RequirePermission('jobs:write')
  @Patch('jobs/:id')
  updateJob(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateJobSchema)) body: UpdateJob,
  ) {
    return this.jobs.updateJob(p, params.id, body);
  }

  // ---- sources ----

  @RequirePermission('sources:manage')
  @Post('sources')
  createSource(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(createSourceSchema)) body: CreateSource,
  ) {
    return this.jobs.createSource(p, body);
  }

  @RequirePermission('sources:manage')
  @Get('sources')
  listSources(@CurrentUser() p: Principal) {
    return this.jobs.listSources(p);
  }

  @RequirePermission('sources:manage')
  @Patch('sources/:id')
  updateSource(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateSourceSchema)) body: UpdateSource,
  ) {
    return this.jobs.updateSource(p, params.id, body);
  }

  @RequirePermission('sources:manage')
  @Delete('sources/:id')
  @HttpCode(204)
  async deleteSource(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    await this.jobs.deleteSource(p, params.id);
  }

  @RequirePermission('sources:manage')
  @Post('sources/:id/run')
  @HttpCode(200)
  runSource(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.jobs.runSource(p, params.id);
  }

  // ---- matches ----

  @RequirePermission('jobs:read', 'candidates:read')
  @Get('matches')
  listMatches(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(listMatchesQuerySchema)) q: ListMatchesQuery,
  ) {
    return this.jobs.listMatches(p, q);
  }

  @RequirePermission('candidates:write')
  @Post('matches/rescore')
  @HttpCode(200)
  rescore(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(rescoreSchema)) body: { candidateProfileId?: string },
  ) {
    return this.jobs.rescore(p, body.candidateProfileId);
  }
}
