import { pageSchema, paginationQuerySchema } from '@jobpilot/kit';
import { z } from 'zod';
import { PROFICIENCIES, REMOTE_PREFS, SKILL_CATEGORIES, WORK_AUTH } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });
export const removeChildParamsSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['skills', 'experience', 'education', 'projects']),
  childId: z.uuid(),
});
export const childKindSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['skills', 'experience', 'education', 'projects']),
});

const text = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(5000);
const list = z.array(z.string().trim().min(1).max(100)).max(30);
const money = z.number().int().min(0).max(10_000_000);
const day = z.iso.date();

export const skillSchema = z.object({
  id: z.uuid(),
  skillName: z.string(),
  category: z.enum(SKILL_CATEGORIES),
  proficiency: z.enum(PROFICIENCIES),
  yearsExperience: z.number().nullable(),
});
export const experienceSchema = z.object({
  id: z.uuid(),
  companyName: z.string(),
  title: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  description: z.string().nullable(),
  technologies: z.array(z.string()),
});
export const educationSchema = z.object({
  id: z.uuid(),
  institution: z.string(),
  degree: z.string(),
  field: z.string().nullable(),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
});
export const projectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  technologies: z.array(z.string()),
  url: z.string().nullable(),
});

export const profileSummarySchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  fullName: z.string(),
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  targetRoles: z.array(z.string()),
  targetLocations: z.array(z.string()),
  salaryMin: z.number().int().nullable(),
  salaryMax: z.number().int().nullable(),
  workAuthStatus: z.enum(WORK_AUTH),
  remotePref: z.enum(REMOTE_PREFS),
  relocationOk: z.boolean(),
  version: z.number().int().min(1),
});
export type ProfileSummaryDto = z.output<typeof profileSummarySchema>;

export const profileSchema = profileSummarySchema.extend({
  yearsExperience: z.number().int().min(0),
  skills: z.array(skillSchema),
  experience: z.array(experienceSchema),
  education: z.array(educationSchema),
  projects: z.array(projectSchema),
});
export type ProfileDto = z.output<typeof profileSchema>;

export const updateProfileSchema = z
  .object({
    version: z.number().int().min(1).describe('The version you last read; a mismatch returns 409'),
    fullName: text.optional(),
    headline: text.nullable().optional(),
    summary: longText.nullable().optional(),
    targetRoles: list.optional(),
    targetLocations: list.optional(),
    salaryMin: money.nullable().optional(),
    salaryMax: money.nullable().optional(),
    workAuthStatus: z.enum(WORK_AUTH).optional(),
    remotePref: z.enum(REMOTE_PREFS).optional(),
    relocationOk: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== 'version'), {
    message: 'Provide at least one field to change',
  });
export type UpdateProfile = z.output<typeof updateProfileSchema>;

export const addSkillSchema = z
  .object({
    skillName: z.string().trim().min(1).max(60),
    category: z.enum(SKILL_CATEGORIES).default('OTHER'),
    proficiency: z.enum(PROFICIENCIES).default('INTERMEDIATE'),
    yearsExperience: z.number().min(0).max(60).optional(),
  })
  .strict();
export const addExperienceSchema = z
  .object({
    companyName: text,
    title: text,
    startDate: day,
    endDate: day.optional(),
    description: longText.optional(),
    technologies: list.default([]),
  })
  .strict()
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'endDate is before startDate',
  });
export const addEducationSchema = z
  .object({
    institution: text,
    degree: text,
    field: text.optional(),
    startDate: day.optional(),
    endDate: day.optional(),
  })
  .strict();
export const addProjectSchema = z
  .object({
    name: text,
    description: longText.optional(),
    technologies: list.default([]),
    url: z
      .url()
      .max(2000)
      .refine((u) => /^https?:\/\//i.test(u), 'Must be an http or https URL')
      .optional(),
  })
  .strict();

export const CHILD_SCHEMAS = {
  skills: addSkillSchema,
  experience: addExperienceSchema,
  education: addEducationSchema,
  projects: addProjectSchema,
} as const;

export const listProfilesQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().describe('Name or headline'),
});
export type ListProfilesQuery = z.output<typeof listProfilesQuerySchema>;
export const profilePageSchema = pageSchema(profileSummarySchema);
