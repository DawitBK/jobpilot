import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import {
  approveSchema,
  createApplicationSchema,
  idParamsSchema,
  listApplicationsQuerySchema,
  transitionSchema,
  type CreateApplication,
  type ListApplicationsQuery,
  type TransitionRequest,
} from './applications.contract.js';
import { ApplicationsService } from './applications.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);

@Controller('api/v1/applications')
export class ApplicationsController {
  constructor(@Inject(ApplicationsService) private readonly applications: ApplicationsService) {}

  @RequirePermission('applications:write')
  @Post()
  create(
    @CurrentUser() p: Principal,
    @Body(new ZodValidationPipe(createApplicationSchema)) body: CreateApplication,
  ) {
    return this.applications.create(p, body);
  }

  @RequirePermission('applications:read')
  @Get()
  list(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(listApplicationsQuerySchema)) q: ListApplicationsQuery,
  ) {
    return this.applications.list(p, q);
  }

  @RequirePermission('applications:read')
  @Get(':id')
  get(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.applications.get(p, params.id);
  }

  @RequirePermission('applications:write')
  @Post(':id/transition')
  @HttpCode(200)
  move(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(transitionSchema)) body: TransitionRequest,
  ) {
    return this.applications.move(p, params.id, body);
  }

  @RequirePermission('applications:approve')
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(approveSchema)) body: { acknowledgeRisks?: boolean } | undefined,
  ) {
    return this.applications.approve(p, params.id, body?.acknowledgeRisks === true);
  }
}
