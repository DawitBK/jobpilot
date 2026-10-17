import { pageSchema, paginationQuerySchema } from '@jobpilot/kit';
import { z } from 'zod';
import { ACTOR_TYPES, APPLICATION_STATES } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

export const applicationSchema = z.object({
  id: z.uuid(),
  candidateProfileId: z.uuid(),
  jobId: z.uuid(),
  jobTitle: z.string(),
  companyName: z.string(),
  state: z.enum(APPLICATION_STATES),
  stateEnteredAt: z.iso.datetime(),
  approvedBy: z.uuid().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  appliedAt: z.iso.datetime().nullable(),
  version: z.number().int().min(1),
});
export type ApplicationDto = z.output<typeof applicationSchema>;

export const eventSchema = z.object({
  fromState: z.string().nullable(),
  toState: z.string(),
  actorType: z.enum(ACTOR_TYPES),
  actorId: z.uuid().nullable(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const applicationDetailSchema = applicationSchema.extend({
  allowedNext: z.array(z.enum(APPLICATION_STATES)),
  match: z
    .object({
      overallScore: z.number(),
      recommendation: z.enum(['APPLY', 'MAYBE', 'SKIP']),
      missingSkills: z.array(z.string()),
    })
    .nullable(),
  events: z.array(eventSchema),
});
export type ApplicationDetailDto = z.output<typeof applicationDetailSchema>;

export const createApplicationSchema = z
  .object({
    jobId: z.uuid(),
    candidateProfileId: z
      .uuid()
      .optional()
      .describe('Defaults to your own profile; only a candidate-role user is held to that'),
  })
  .strict();
export type CreateApplication = z.output<typeof createApplicationSchema>;

export const transitionSchema = z
  .object({
    to: z.enum(APPLICATION_STATES),
    note: z.string().trim().min(1).max(500).optional(),
  })
  .strict();
export type TransitionRequest = z.output<typeof transitionSchema>;

export const listApplicationsQuerySchema = paginationQuerySchema.extend({
  state: z.enum(APPLICATION_STATES).optional(),
  candidateProfileId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});
export type ListApplicationsQuery = z.output<typeof listApplicationsQuerySchema>;
export const applicationPageSchema = pageSchema(applicationSchema);
