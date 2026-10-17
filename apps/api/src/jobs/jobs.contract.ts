import { pageSchema, paginationQuerySchema, sortQuerySchema } from '@jobpilot/kit';
import { z } from 'zod';
import {
  EMPLOYMENT_TYPES,
  JOB_STATUSES,
  RECOMMENDATIONS,
  REMOTE_TYPES,
  SENIORITIES,
  SOURCE_TYPES,
} from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

const versionField = z
  .number()
  .int()
  .min(1)
  .describe('The version you last read; a mismatch returns 409');
const skills = z.array(z.string().trim().min(1).max(60)).max(60);
const httpUrl = z
  .url()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http or https URL');

export const jobSchema = z.object({
  id: z.uuid(),
  companyId: z.uuid(),
  companyName: z.string(),
  sourceId: z.uuid().nullable(),
  title: z.string(),
  description: z.string(),
  location: z.string().nullable(),
  remoteType: z.enum(REMOTE_TYPES),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  seniority: z.enum(SENIORITIES).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  requiredSkills: z.array(z.string()),
  preferredSkills: z.array(z.string()),
  visaSponsorship: z.boolean().nullable(),
  applicationUrl: z.string().nullable(),
  postedAt: z.iso.datetime(),
  status: z.enum(JOB_STATUSES),
  version: z.number().int().min(1),
});
export type JobDto = z.output<typeof jobSchema>;

export const createJobSchema = z
  .object({
    companyName: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(50_000).default(''),
    location: z.string().trim().min(1).max(200).optional(),
    remoteType: z.enum(REMOTE_TYPES).default('ONSITE'),
    salaryMin: z.number().int().min(0).max(10_000_000).optional(),
    salaryMax: z.number().int().min(0).max(10_000_000).optional(),
    seniority: z.enum(SENIORITIES).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).default('FULL_TIME'),
    requiredSkills: skills.default([]),
    preferredSkills: skills.default([]),
    visaSponsorship: z.boolean().optional(),
    applicationUrl: httpUrl.optional(),
  })
  .strict()
  .refine(
    (v) => v.salaryMin === undefined || v.salaryMax === undefined || v.salaryMin <= v.salaryMax,
    {
      message: 'salaryMin must not exceed salaryMax',
    },
  );
export type CreateJob = z.output<typeof createJobSchema>;

export const updateJobSchema = z
  .object({
    version: versionField,
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(50_000).optional(),
    location: z.string().trim().min(1).max(200).nullable().optional(),
    remoteType: z.enum(REMOTE_TYPES).optional(),
    salaryMin: z.number().int().min(0).max(10_000_000).nullable().optional(),
    salaryMax: z.number().int().min(0).max(10_000_000).nullable().optional(),
    seniority: z.enum(SENIORITIES).nullable().optional(),
    requiredSkills: skills.optional(),
    preferredSkills: skills.optional(),
    visaSponsorship: z.boolean().nullable().optional(),
    applicationUrl: httpUrl.nullable().optional(),
    status: z.enum(JOB_STATUSES).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateJob = z.output<typeof updateJobSchema>;

export const JOB_SORT_FIELDS = ['postedAt', 'title'] as const;
export type JobSortField = (typeof JOB_SORT_FIELDS)[number];
export const listJobsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Title, company or description'),
  remoteType: z.enum(REMOTE_TYPES).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  skill: z.string().trim().min(1).max(60).optional().describe('Requires this skill'),
  sort: sortQuerySchema(JOB_SORT_FIELDS, [{ field: 'postedAt', direction: 'desc' }]),
});
export type ListJobsQuery = z.output<typeof listJobsQuerySchema>;
export const jobPageSchema = pageSchema(jobSchema);

// ---- sources ----

export const sourceSchema = z.object({
  id: z.uuid(),
  type: z.enum(SOURCE_TYPES),
  name: z.string(),
  config: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  pollIntervalMinutes: z.number().int(),
  lastRunAt: z.iso.datetime().nullable(),
  lastRunStatus: z.enum(['OK', 'ERROR']).nullable(),
  lastRunMessage: z.string().nullable(),
  version: z.number().int().min(1),
});
export type SourceDto = z.output<typeof sourceSchema>;

const configSchema = z
  .record(z.string().min(1).max(60), z.string().max(500))
  .refine((c) => Object.keys(c).length <= 10, 'At most 10 settings');

export const createSourceSchema = z
  .object({
    type: z.enum(SOURCE_TYPES),
    name: z.string().trim().min(1).max(120),
    config: configSchema,
    pollIntervalMinutes: z.number().int().min(5).max(10_080).default(60),
  })
  .strict();
export type CreateSource = z.output<typeof createSourceSchema>;

export const updateSourceSchema = z
  .object({
    version: versionField,
    name: z.string().trim().min(1).max(120).optional(),
    config: configSchema.optional(),
    enabled: z.boolean().optional(),
    pollIntervalMinutes: z.number().int().min(5).max(10_080).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateSource = z.output<typeof updateSourceSchema>;

export const runResultSchema = z.object({
  fetched: z.number().int(),
  created: z.number().int().describe('New jobs'),
  duplicates: z.number().int().describe('Postings already known (same company, title and place)'),
  discarded: z.number().int().describe('Postings that could not be understood'),
  matched: z.number().int().describe('Candidate matches written for the new jobs'),
});
export type RunResult = z.output<typeof runResultSchema>;

// ---- matches ----

export const matchSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  jobTitle: z.string(),
  companyName: z.string(),
  candidateProfileId: z.uuid(),
  overallScore: z.number(),
  technicalScore: z.number(),
  locationScore: z.number(),
  salaryScore: z.number(),
  seniorityScore: z.number(),
  missingSkills: z.array(z.string()),
  strongEvidence: z.array(z.string()),
  hardFilters: z.array(z.string()),
  recommendation: z.enum(RECOMMENDATIONS),
  scoringVersion: z.string(),
});
export type MatchDto = z.output<typeof matchSchema>;

export const listMatchesQuerySchema = paginationQuerySchema.extend({
  recommendation: z.enum(RECOMMENDATIONS).optional(),
  candidateProfileId: z.uuid().optional(),
  minScore: z.coerce.number().min(0).max(100).optional(),
});
export type ListMatchesQuery = z.output<typeof listMatchesQuerySchema>;
export const matchPageSchema = pageSchema(matchSchema);

export const rescoreSchema = z.object({ candidateProfileId: z.uuid().optional() }).strict();
