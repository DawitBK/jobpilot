import { Controller, Get } from '@nestjs/common';
import {
  OpenApiRegistry,
  paginationQuerySchema,
  type HttpMethod,
  type RouteDef,
} from '@jobpilot/kit';
import { z } from 'zod';
import * as app from './applications/applications.contract.js';
import * as auth from './auth/auth.contract.js';
import * as cand from './candidates/candidates.contract.js';
import { Public } from './common/auth.js';
import * as job from './jobs/jobs.contract.js';

type Access = 'public' | 'signed-in' | string;

const idParams = z.object({ id: z.uuid() });
const childParams = z.object({ id: z.uuid(), childId: z.uuid() });
const accessByOperation = new Map<string, Access>();
const o = (schema: unknown) => schema as z.ZodObject;

interface Spec {
  /** `public`, `signed-in`, or the permission(s) the route needs. */
  access: Access;
  method: HttpMethod;
  path: string;
  id: string;
  summary: string;
  tag: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  ok?: [number, z.ZodType | null];
}

const route = (s: Spec): RouteDef => {
  accessByOperation.set(s.id, s.access);
  const note =
    s.access === 'public'
      ? 'No sign-in needed.'
      : s.access === 'signed-in'
        ? 'Any signed-in user.'
        : `Needs the \`${s.access}\` permission.`;
  const [status, schema] = s.ok ?? [200, null];
  return {
    method: s.method,
    path: `/api/v1${s.path}`,
    operationId: s.id,
    summary: `${s.summary}. ${note}`,
    tags: [s.tag],
    request: {
      ...(s.params ? { params: s.params } : {}),
      ...(s.query ? { query: s.query } : {}),
      ...(s.body ? { body: s.body } : {}),
    },
    responses: { [status]: { description: 'Success', ...(schema ? { schema } : {}) } },
  };
};

const created = (schema: z.ZodType): [number, z.ZodType] => [201, schema];
const ok = (schema: z.ZodType): [number, z.ZodType] => [200, schema];
const none: [number, null] = [204, null];

let cached: Record<string, unknown> | undefined;

/** The OpenAPI document, built from the same schemas the controllers validate with. */
export function openApiDocument(): Record<string, unknown> {
  if (cached) return cached;
  const registry = new OpenApiRegistry({
    title: 'JobPilot API',
    version: '0.1.0',
    description:
      'Multi-tenant job-search platform: every tenant table is protected by row-level security.',
  });
  const page = o(paginationQuerySchema);

  const specs: Spec[] = [
    {
      access: 'public',
      method: 'post',
      path: '/auth/register',
      id: 'register',
      summary: 'Create an account and a personal workspace',
      tag: 'auth',
      body: auth.registerSchema,
      ok: created(auth.userSchema),
    },
    {
      access: 'public',
      method: 'post',
      path: '/auth/login',
      id: 'login',
      summary: 'Sign in: tokens for one organization, or a selection token to choose among several',
      tag: 'auth',
      body: auth.loginSchema,
      ok: ok(z.union([auth.tokenPairSchema, auth.organizationChoiceSchema])),
    },
    {
      access: 'public',
      method: 'post',
      path: '/auth/select-organization',
      id: 'selectOrganization',
      summary: 'Choose an organization with the selection token',
      tag: 'auth',
      body: auth.selectOrganizationSchema,
      ok: ok(auth.tokenPairSchema),
    },
    {
      access: 'public',
      method: 'post',
      path: '/auth/refresh',
      id: 'refresh',
      summary: 'Rotate a refresh token (a reused token revokes the whole session)',
      tag: 'auth',
      body: auth.refreshSchema,
      ok: ok(auth.tokenPairSchema),
    },
    {
      access: 'public',
      method: 'post',
      path: '/auth/logout',
      id: 'logout',
      summary: 'Revoke the session of a refresh token',
      tag: 'auth',
      body: auth.refreshSchema,
      ok: none,
    },
    {
      access: 'signed-in',
      method: 'get',
      path: '/me',
      id: 'getMe',
      summary: 'Who you are, in which organization, with which permissions',
      tag: 'auth',
      ok: ok(auth.meSchema),
    },
    {
      access: 'organizations:manage',
      method: 'patch',
      path: '/organization',
      id: 'renameOrganization',
      summary: 'Rename the organization',
      tag: 'organization',
      body: auth.updateOrganizationSchema,
    },
    {
      access: 'members:read',
      method: 'get',
      path: '/organization/members',
      id: 'listMembers',
      summary: 'Members and their roles',
      tag: 'organization',
      ok: ok(z.array(auth.memberSchema)),
    },
    {
      access: 'members:invite',
      method: 'post',
      path: '/organization/members',
      id: 'addMember',
      summary: 'Add a registered person to the organization with a role',
      tag: 'organization',
      body: auth.addMemberSchema,
      ok: created(auth.memberSchema),
    },
    {
      access: 'members:invite',
      method: 'patch',
      path: '/organization/members/{id}',
      id: 'updateMember',
      summary: 'Change a role or remove a member (ends their sessions here)',
      tag: 'organization',
      params: idParams,
      body: auth.updateMemberSchema,
      ok: ok(auth.memberSchema),
    },

    {
      access: 'candidates:read',
      method: 'get',
      path: '/candidates/me',
      id: 'getMyProfile',
      summary: 'Your own candidate profile (created on first use)',
      tag: 'candidates',
      ok: ok(cand.profileSchema),
    },
    {
      access: 'candidates:read',
      method: 'get',
      path: '/candidates',
      id: 'listCandidates',
      summary: 'Candidate profiles (a candidate sees only their own)',
      tag: 'candidates',
      query: cand.listProfilesQuerySchema,
      ok: ok(cand.profilePageSchema),
    },
    {
      access: 'candidates:read',
      method: 'get',
      path: '/candidates/{id}',
      id: 'getCandidate',
      summary: 'A profile with its whole career graph',
      tag: 'candidates',
      params: idParams,
      ok: ok(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'patch',
      path: '/candidates/{id}',
      id: 'updateCandidate',
      summary: 'Update a profile (optimistic concurrency via version)',
      tag: 'candidates',
      params: idParams,
      body: cand.updateProfileSchema,
      ok: ok(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'post',
      path: '/candidates/{id}/skills',
      id: 'addSkill',
      summary: 'Add a skill',
      tag: 'candidates',
      params: idParams,
      body: cand.addSkillSchema,
      ok: created(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'post',
      path: '/candidates/{id}/experience',
      id: 'addExperience',
      summary: 'Add a job held',
      tag: 'candidates',
      params: idParams,
      body: cand.addExperienceSchema,
      ok: created(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'post',
      path: '/candidates/{id}/education',
      id: 'addEducation',
      summary: 'Add a qualification',
      tag: 'candidates',
      params: idParams,
      body: cand.addEducationSchema,
      ok: created(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'post',
      path: '/candidates/{id}/projects',
      id: 'addProject',
      summary: 'Add a project',
      tag: 'candidates',
      params: idParams,
      body: cand.addProjectSchema,
      ok: created(cand.profileSchema),
    },
    {
      access: 'candidates:write',
      method: 'delete',
      path: '/candidates/{id}/{kind}/{childId}',
      id: 'removeCareerEntry',
      summary:
        'Remove a skill, job, qualification or project (kind: skills, experience, education, projects)',
      tag: 'candidates',
      params: childParams.extend({
        kind: z.enum(['skills', 'experience', 'education', 'projects']),
      }),
      ok: ok(cand.profileSchema),
    },

    {
      access: 'jobs:write',
      method: 'post',
      path: '/jobs',
      id: 'createJob',
      summary: 'Add a job by hand; it is scored against every candidate',
      tag: 'jobs',
      body: job.createJobSchema,
      ok: created(job.jobSchema),
    },
    {
      access: 'jobs:read',
      method: 'get',
      path: '/jobs',
      id: 'listJobs',
      summary: 'Search jobs',
      tag: 'jobs',
      query: o(job.listJobsQuerySchema),
      ok: ok(job.jobPageSchema),
    },
    {
      access: 'jobs:read',
      method: 'get',
      path: '/jobs/{id}',
      id: 'getJob',
      summary: 'A job',
      tag: 'jobs',
      params: idParams,
      ok: ok(job.jobSchema),
    },
    {
      access: 'jobs:write',
      method: 'patch',
      path: '/jobs/{id}',
      id: 'updateJob',
      summary: 'Update a job; its matches are recomputed',
      tag: 'jobs',
      params: idParams,
      body: job.updateJobSchema,
      ok: ok(job.jobSchema),
    },
    {
      access: 'sources:manage',
      method: 'post',
      path: '/sources',
      id: 'createSource',
      summary: 'Register an RSS or Greenhouse source',
      tag: 'sources',
      body: job.createSourceSchema,
      ok: created(job.sourceSchema),
    },
    {
      access: 'sources:manage',
      method: 'get',
      path: '/sources',
      id: 'listSources',
      summary: 'List sources',
      tag: 'sources',
      ok: ok(z.array(job.sourceSchema)),
    },
    {
      access: 'sources:manage',
      method: 'patch',
      path: '/sources/{id}',
      id: 'updateSource',
      summary: 'Update or disable a source',
      tag: 'sources',
      params: idParams,
      body: job.updateSourceSchema,
      ok: ok(job.sourceSchema),
    },
    {
      access: 'sources:manage',
      method: 'delete',
      path: '/sources/{id}',
      id: 'deleteSource',
      summary: 'Delete a source that no job came from',
      tag: 'sources',
      params: idParams,
      ok: none,
    },
    {
      access: 'sources:manage',
      method: 'post',
      path: '/sources/{id}/run',
      id: 'runSource',
      summary: 'Poll a source now: fetch, normalize, de-duplicate, add jobs and score them',
      tag: 'sources',
      params: idParams,
      ok: ok(job.runResultSchema),
    },
    {
      access: 'jobs:read',
      method: 'get',
      path: '/matches',
      id: 'listMatches',
      summary: 'Matches, best first, with what is missing and what is strong',
      tag: 'matches',
      query: o(job.listMatchesQuerySchema),
      ok: ok(job.matchPageSchema),
    },
    {
      access: 'candidates:write',
      method: 'post',
      path: '/matches/rescore',
      id: 'rescoreMatches',
      summary: 'Score every open job again for a candidate',
      tag: 'matches',
      body: z.object({ candidateProfileId: z.uuid().optional() }),
      ok: ok(z.object({ matches: z.number().int() })),
    },

    {
      access: 'applications:write',
      method: 'post',
      path: '/applications',
      id: 'createApplication',
      summary: 'Start an application by hand',
      tag: 'applications',
      body: app.createApplicationSchema,
      ok: created(app.applicationDetailSchema),
    },
    {
      access: 'applications:read',
      method: 'get',
      path: '/applications',
      id: 'listApplications',
      summary: 'Applications',
      tag: 'applications',
      query: o(app.listApplicationsQuerySchema),
      ok: ok(app.applicationPageSchema),
    },
    {
      access: 'applications:read',
      method: 'get',
      path: '/applications/{id}',
      id: 'getApplication',
      summary: 'An application with its history and the moves open to it',
      tag: 'applications',
      params: idParams,
      ok: ok(app.applicationDetailSchema),
    },
    {
      access: 'applications:write',
      method: 'post',
      path: '/applications/{id}/transition',
      id: 'transitionApplication',
      summary: 'Move an application along the state machine (approval has its own call)',
      tag: 'applications',
      params: idParams,
      body: app.transitionSchema,
      ok: ok(app.applicationDetailSchema),
    },
    {
      access: 'applications:approve',
      method: 'post',
      path: '/applications/{id}/approve',
      id: 'approveApplication',
      summary: 'Approve an application that is ready (only a person can; it records who and when)',
      tag: 'applications',
      params: idParams,
      ok: ok(app.applicationDetailSchema),
    },

    {
      access: 'audit:read',
      method: 'get',
      path: '/audit',
      id: 'listAudit',
      summary: 'The audit trail, newest first',
      tag: 'audit',
      query: page,
    },
    {
      access: 'audit:read',
      method: 'get',
      path: '/audit/verify',
      id: 'verifyAudit',
      summary: 'Recompute the audit hash chain',
      tag: 'audit',
      ok: ok(
        z.object({
          valid: z.boolean(),
          checked: z.number().int(),
          brokenAt: z.number().int().nullable(),
        }),
      ),
    },
  ];
  for (const s of specs) registry.add(route(s));

  const doc = registry.document() as {
    paths: Record<string, Record<string, Record<string, unknown>>>;
  };
  for (const methods of Object.values(doc.paths)) {
    for (const op of Object.values(methods)) {
      const access = accessByOperation.get(op['operationId'] as string);
      if (access && access !== 'public') op['security'] = [{ bearerAuth: [] }];
    }
  }
  cached = {
    ...doc,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
  };
  return cached;
}

@Controller()
export class OpenApiController {
  @Public()
  @Get('openapi.json')
  document() {
    return openApiDocument();
  }
}
