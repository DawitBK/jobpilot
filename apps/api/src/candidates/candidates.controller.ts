import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ZodValidationPipe } from '@jobpilot/kit';
import { CurrentUser, RequirePermission, type Principal } from '../common/auth.js';
import {
  CHILD_SCHEMAS,
  childKindSchema,
  removeChildParamsSchema,
  idParamsSchema,
  listProfilesQuerySchema,
  updateProfileSchema,
  type ListProfilesQuery,
  type UpdateProfile,
} from './candidates.contract.js';
import { CandidatesService, type ChildKind } from './candidates.service.js';

const idParams = new ZodValidationPipe(idParamsSchema);

@Controller('api/v1/candidates')
export class CandidatesController {
  constructor(@Inject(CandidatesService) private readonly candidates: CandidatesService) {}

  @RequirePermission('candidates:read')
  @Get('me')
  mine(@CurrentUser() p: Principal) {
    return this.candidates.mine(p);
  }

  @RequirePermission('candidates:read')
  @Get()
  list(
    @CurrentUser() p: Principal,
    @Query(new ZodValidationPipe(listProfilesQuerySchema)) q: ListProfilesQuery,
  ) {
    return this.candidates.list(p, q);
  }

  @RequirePermission('candidates:read')
  @Get(':id')
  get(@CurrentUser() p: Principal, @Param(idParams) params: { id: string }) {
    return this.candidates.get(p, params.id);
  }

  @RequirePermission('candidates:write')
  @Patch(':id')
  update(
    @CurrentUser() p: Principal,
    @Param(idParams) params: { id: string },
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfile,
  ) {
    return this.candidates.update(p, params.id, body);
  }

  /** Add a skill, a job, a degree or a project to the career graph. The body is checked per kind. */
  @RequirePermission('candidates:write')
  @Post(':id/:kind')
  add(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(childKindSchema)) params: { id: string; kind: ChildKind },
    @Body() body: unknown,
  ) {
    const parsed = CHILD_SCHEMAS[params.kind].parse(body);
    return this.candidates.addChild(p, params.id, params.kind, parsed as never);
  }

  @RequirePermission('candidates:write')
  @Delete(':id/:kind/:childId')
  remove(
    @CurrentUser() p: Principal,
    @Param(new ZodValidationPipe(removeChildParamsSchema))
    params: { id: string; kind: ChildKind; childId: string },
  ) {
    return this.candidates.removeChild(p, params.id, params.kind, params.childId);
  }
}
