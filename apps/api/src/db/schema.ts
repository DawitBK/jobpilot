import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const ROLE_NAMES = [
  'OWNER',
  'ADMIN',
  'RECRUITER',
  'HIRING_MANAGER',
  'ANALYST',
  'CANDIDATE',
] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const WORK_AUTH = [
  'CITIZEN',
  'PERMANENT_RESIDENT',
  'VISA_HOLDER',
  'NEEDS_SPONSORSHIP',
  'OTHER',
] as const;
export const REMOTE_PREFS = ['REMOTE_ONLY', 'HYBRID', 'ONSITE', 'FLEXIBLE'] as const;
export const SKILL_CATEGORIES = [
  'FRONTEND',
  'BACKEND',
  'DATABASE',
  'DEVOPS',
  'SOFT',
  'OTHER',
] as const;
export const PROFICIENCIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'] as const;
export const REMOTE_TYPES = ['REMOTE', 'HYBRID', 'ONSITE'] as const;
export const SENIORITIES = ['ENTRY', 'MID', 'SENIOR', 'STAFF', 'PRINCIPAL'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP'] as const;
export const JOB_STATUSES = ['ACTIVE', 'EXPIRED', 'CLOSED'] as const;
export const SOURCE_TYPES = [
  'RSS',
  'GREENHOUSE',
  'LEVER',
  'ASHBY',
  'WORKABLE',
  'SMARTRECRUITERS',
  'RECRUITEE',
  'BREEZY',
  'PERSONIO',
  'BAMBOOHR',
  'WORKDAY',
  'REMOTIVE',
  'REMOTEOK',
  'HIMALAYAS',
  'ARBEITNOW',
  'JOBICY',
  'HACKERNEWS',
  'GOOGLE_CAREERS',
  'STRUCTURED_DATA',
  'JSON_API',
  'HTML_LIST',
] as const;
export const RECOMMENDATIONS = ['APPLY', 'MAYBE', 'SKIP'] as const;
export const APPLICATION_STATES = [
  'DISCOVERED',
  'MATCHED',
  'SHORTLISTED',
  'RESUME_GENERATED',
  'COVER_LETTER_GENERATED',
  'READY_TO_APPLY',
  'APPROVED',
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'FINAL_INTERVIEW',
  'OFFER',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
  'NO_RESPONSE',
  'EXPIRED',
  'NEEDS_HUMAN_REVIEW',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];
export const ACTOR_TYPES = ['SYSTEM', 'USER', 'AI_AGENT', 'BROWSER_WORKER'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const version = () => integer('version').notNull().default(1);
const orgId = () => uuid('organization_id').notNull();
const inList = (column: unknown, values: readonly string[]) =>
  sql`${column} in (${sql.join(
    values.map((v) => sql.raw(`'${v}'`)),
    sql`, `,
  )})`;

// ---------------------------------------------------------------- identity and tenancy

/** A person. Global (one row per human, in no tenant), so it is not under row-level security. */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    status: text('status', { enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] })
      .notNull()
      .default('ACTIVE'),
    /** The identity provider's id for this person ("sub"), bound at the first single sign-on; it is how a sign-out at the provider finds the account. */
    ssoSubject: text('sso_subject'),
    /** The platform administrator's account: in no member list and out of reach of every other user (answers like an id that was never there). */
    platformAdmin: boolean('platform_admin').notNull().default(false),
    /** AES-256-GCM ciphertext of the TOTP secret; set when enrolment starts, usable only once `totpEnabledAt` is set. */
    totpSecretEnc: text('totp_secret_enc'),
    totpEnabledAt: timestamp('totp_enabled_at', { withTimezone: true }),
    /** The last accepted 30-second step: a code cannot be used twice. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_sso_subject_uq')
      .on(t.ssoSubject)
      .where(sql`${t.ssoSubject} is not null`),
  ],
);

export const organizations = pgTable(
  'organizations',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    plan: text('plan', { enum: ['FREE', 'PRO', 'TEAM', 'ENTERPRISE'] })
      .notNull()
      .default('FREE'),
    status: text('status', { enum: ['ACTIVE', 'SUSPENDED', 'DELETED'] })
      .notNull()
      .default('ACTIVE'),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id),
    /** Review rules (see policy.ts); empty means the defaults. */
    policy: jsonb('policy')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)],
);

/** NULL organization_id rows are the platform's role templates; everything else belongs to a tenant. */
export const roles = pgTable(
  'roles',
  {
    id: id(),
    organizationId: uuid('organization_id').references(() => organizations.id),
    name: text('name', { enum: ROLE_NAMES }).notNull(),
    permissions: jsonb('permissions').$type<string[]>().notNull(),
  },
  (t) => [
    check('roles_name_valid', inList(t.name, ROLE_NAMES)),
    uniqueIndex('roles_template_uq')
      .on(t.name)
      .where(sql`${t.organizationId} is null`),
  ],
);

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    status: text('status', { enum: ['ACTIVE', 'REMOVED'] })
      .notNull()
      .default('ACTIVE'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('organization_members_uq').on(t.organizationId, t.userId),
    index('organization_members_user_idx').on(t.userId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

/** Tamper-evident: each row's hash covers the previous row's hash (see audit.ts). Append-only by trigger. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: orgId(),
    actorUserId: uuid('actor_user_id'),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    prevHash: text('prev_hash').notNull(),
    selfHash: text('self_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_org_idx').on(t.organizationId, t.id)],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: orgId(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status', { enum: ['PENDING', 'DISPATCHED', 'FAILED'] })
      .notNull()
      .default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    /** Not tried again before this time: failed deliveries back off instead of spinning. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: createdAt(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
  },
  (t) => [index('outbox_pending_idx').on(t.status, t.nextAttemptAt, t.id)],
);

export const NOTIFICATION_KINDS = [
  'WELCOME',
  'NEW_MATCH',
  'APPROVAL_NEEDED',
  'APPLICATION_UPDATE',
  'NEEDS_REVIEW',
  'JOBS_FOUND',
  'SECURITY',
  'PLAN',
] as const;

/** A message for one person inside one organization, made from an outbox event by the dispatcher. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    kind: text('kind', { enum: NOTIFICATION_KINDS }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** A path inside the web app. */
    link: text('link'),
    eventId: bigint('event_id', { mode: 'number' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    emailStatus: text('email_status', { enum: ['NOT_SENT', 'SENT', 'FAILED', 'SKIPPED'] })
      .notNull()
      .default('NOT_SENT'),
    createdAt: createdAt(),
  },
  (t) => [
    check('notifications_link_local', sql`${t.link} is null or ${t.link} ~ '^/'`),
    uniqueIndex('notifications_event_user_uq')
      .on(t.eventId, t.userId)
      .where(sql`${t.eventId} is not null`),
    index('notifications_user_idx').on(t.userId, t.createdAt),
  ],
);

// ---------------------------------------------------------------- career graph

export const candidateProfiles = pgTable(
  'candidate_profiles',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    fullName: text('full_name').notNull(),
    headline: text('headline'),
    summary: text('summary'),
    targetRoles: text('target_roles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    targetLocations: text('target_locations')
      .array()
      .notNull()
      .default(sql`'{}'`),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    workAuthStatus: text('work_auth_status', { enum: WORK_AUTH }).notNull().default('OTHER'),
    remotePref: text('remote_pref', { enum: REMOTE_PREFS }).notNull().default('FLEXIBLE'),
    relocationOk: boolean('relocation_ok').notNull().default(false),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('candidate_profiles_uq').on(t.organizationId, t.userId),
    check('candidate_profiles_work_auth', inList(t.workAuthStatus, WORK_AUTH)),
    check('candidate_profiles_remote_pref', inList(t.remotePref, REMOTE_PREFS)),
    check(
      'candidate_profiles_salary_range',
      sql`${t.salaryMin} is null or ${t.salaryMax} is null or ${t.salaryMin} <= ${t.salaryMax}`,
    ),
  ],
);

/** The columns every row of the career graph shares: its own id, its tenant, and the profile it belongs to. */
const childColumns = () => ({
  id: id(),
  organizationId: orgId().references(() => organizations.id),
  candidateProfileId: uuid('candidate_profile_id')
    .notNull()
    .references(() => candidateProfiles.id),
});

export const candidateSkills = pgTable(
  'candidate_skills',
  {
    ...childColumns(),
    skillName: text('skill_name').notNull(),
    category: text('category', { enum: SKILL_CATEGORIES }).notNull().default('OTHER'),
    proficiency: text('proficiency', { enum: PROFICIENCIES }).notNull().default('INTERMEDIATE'),
    yearsExperience: numeric('years_experience', { precision: 4, scale: 1 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('candidate_skills_uq').on(t.candidateProfileId, sql`lower(${t.skillName})`),
    check('candidate_skills_category', inList(t.category, SKILL_CATEGORIES)),
    check('candidate_skills_proficiency', inList(t.proficiency, PROFICIENCIES)),
  ],
);

export const candidateExperience = pgTable(
  'candidate_experience',
  {
    ...childColumns(),
    companyName: text('company_name').notNull(),
    title: text('title').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    description: text('description'),
    technologies: text('technologies')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'candidate_experience_dates',
      sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`,
    ),
    index('candidate_experience_profile_idx').on(t.candidateProfileId),
  ],
);

export const candidateEducation = pgTable(
  'candidate_education',
  {
    ...childColumns(),
    institution: text('institution').notNull(),
    degree: text('degree').notNull(),
    field: text('field'),
    startDate: date('start_date', { mode: 'string' }),
    endDate: date('end_date', { mode: 'string' }),
    createdAt: createdAt(),
  },
  (t) => [index('candidate_education_profile_idx').on(t.candidateProfileId)],
);

export const candidateProjects = pgTable(
  'candidate_projects',
  {
    ...childColumns(),
    name: text('name').notNull(),
    description: text('description'),
    technologies: text('technologies')
      .array()
      .notNull()
      .default(sql`'{}'`),
    url: text('url'),
    createdAt: createdAt(),
  },
  (t) => [index('candidate_projects_profile_idx').on(t.candidateProfileId)],
);

// ---------------------------------------------------------------- job intelligence

/** Shared reference data (a company is the same company for every tenant): the one table with no organization. */
export const companies = pgTable(
  'companies',
  {
    id: id(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    domain: text('domain'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('companies_normalized_uq').on(t.normalizedName)],
);

export const jobSources = pgTable(
  'job_sources',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    type: text('type', { enum: SOURCE_TYPES }).notNull(),
    name: text('name').notNull(),
    config: jsonb('config').$type<Record<string, string>>().notNull(),
    enabled: boolean('enabled').notNull().default(true),
    pollIntervalMinutes: integer('poll_interval_minutes').notNull().default(60),
    /** What the source keeps (see jobs/filters.ts); empty keeps everything. */
    filters: jsonb('filters')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The catalog entry this source was made from, so the screen can show its name and tell the person how it was set up. */
    presetId: text('preset_id'),
    /** Not read again before this time; pushed out after a failure, so a broken source backs off instead of hammering. */
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastRunStatus: text('last_run_status', { enum: ['OK', 'ERROR'] }),
    lastRunMessage: text('last_run_message'),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    check('job_sources_type', inList(t.type, SOURCE_TYPES)),
    check('job_sources_poll', sql`${t.pollIntervalMinutes} between 5 and 10080`),
    uniqueIndex('job_sources_name_uq').on(t.organizationId, sql`lower(${t.name})`),
  ],
);

export const rawJobs = pgTable(
  'raw_jobs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id),
    rawPayload: jsonb('raw_payload').notNull(),
    dedupHash: text('dedup_hash').notNull(),
    status: text('status', { enum: ['PENDING', 'PROCESSED', 'DISCARDED'] })
      .notNull()
      .default('PENDING'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    index('raw_jobs_status_idx').on(t.status, t.fetchedAt),
    index('raw_jobs_hash_idx').on(t.dedupHash),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id),
    sourceId: uuid('source_id').references(() => jobSources.id),
    externalId: text('external_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location'),
    remoteType: text('remote_type', { enum: REMOTE_TYPES }).notNull().default('ONSITE'),
    salaryMin: integer('salary_min'),
    salaryMax: integer('salary_max'),
    seniority: text('seniority', { enum: SENIORITIES }),
    employmentType: text('employment_type', { enum: EMPLOYMENT_TYPES })
      .notNull()
      .default('FULL_TIME'),
    requiredSkills: text('required_skills')
      .array()
      .notNull()
      .default(sql`'{}'`),
    preferredSkills: text('preferred_skills')
      .array()
      .notNull()
      .default(sql`'{}'`),
    visaSponsorship: boolean('visa_sponsorship'),
    applicationUrl: text('application_url'),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    dedupHash: text('dedup_hash').notNull(),
    status: text('status', { enum: JOB_STATUSES }).notNull().default('ACTIVE'),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    check('jobs_remote_type', inList(t.remoteType, REMOTE_TYPES)),
    check('jobs_status', inList(t.status, JOB_STATUSES)),
    check(
      'jobs_salary_range',
      sql`${t.salaryMin} is null or ${t.salaryMax} is null or ${t.salaryMin} <= ${t.salaryMax}`,
    ),
    check(
      'jobs_url_scheme',
      sql`${t.applicationUrl} is null or ${t.applicationUrl} ~ '^https?://'`,
    ),
    // The same posting is stored once per tenant, however many sources or re-polls deliver it.
    uniqueIndex('jobs_dedup_uq').on(t.organizationId, t.dedupHash),
    index('jobs_org_status_idx').on(t.organizationId, t.status, t.postedAt),
  ],
);

export const jobMatches = pgTable(
  'job_matches',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    candidateProfileId: uuid('candidate_profile_id')
      .notNull()
      .references(() => candidateProfiles.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    overallScore: numeric('overall_score', { precision: 5, scale: 2 }).notNull(),
    technicalScore: numeric('technical_score', { precision: 5, scale: 2 }).notNull(),
    locationScore: numeric('location_score', { precision: 5, scale: 2 }).notNull(),
    salaryScore: numeric('salary_score', { precision: 5, scale: 2 }).notNull(),
    seniorityScore: numeric('seniority_score', { precision: 5, scale: 2 }).notNull(),
    missingSkills: text('missing_skills')
      .array()
      .notNull()
      .default(sql`'{}'`),
    strongEvidence: text('strong_evidence')
      .array()
      .notNull()
      .default(sql`'{}'`),
    hardFilters: text('hard_filters')
      .array()
      .notNull()
      .default(sql`'{}'`),
    recommendation: text('recommendation', { enum: RECOMMENDATIONS }).notNull(),
    scoringVersion: text('scoring_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('job_matches_recommendation', inList(t.recommendation, RECOMMENDATIONS)),
    check('job_matches_scores', sql`${t.overallScore} between 0 and 100`),
    uniqueIndex('job_matches_uq').on(t.candidateProfileId, t.jobId),
  ],
);

// ---------------------------------------------------------------- applications

export const applications = pgTable(
  'applications',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    candidateProfileId: uuid('candidate_profile_id')
      .notNull()
      .references(() => candidateProfiles.id),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    state: text('state', { enum: APPLICATION_STATES }).notNull().default('DISCOVERED'),
    stateEnteredAt: timestamp('state_entered_at', { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    nextActionAt: timestamp('next_action_at', { withTimezone: true }),
    version: version(),
    createdAt: createdAt(),
  },
  (t) => [
    check('applications_state', inList(t.state, APPLICATION_STATES)),
    // An application can only have been approved by a person, and it is recorded who and when.
    check(
      'applications_approval_recorded',
      sql`${t.state} not in ('APPROVED', 'APPLIED', 'SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'ACCEPTED') or ${t.approvedBy} is not null`,
    ),
    uniqueIndex('applications_uq').on(t.candidateProfileId, t.jobId),
    index('applications_org_state_idx').on(t.organizationId, t.state),
  ],
);

export const applicationEvents = pgTable(
  'application_events',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    fromState: text('from_state'),
    toState: text('to_state').notNull(),
    actorType: text('actor_type', { enum: ACTOR_TYPES }).notNull(),
    actorId: uuid('actor_id'),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload')
      .notNull()
      .default(sql`'{}'`),
    createdAt: createdAt(),
  },
  (t) => [
    check('application_events_actor', inList(t.actorType, ACTOR_TYPES)),
    // Only a person can approve: the browser worker and the AI are structurally unable to.
    check(
      'application_events_approval_by_user',
      sql`${t.toState} <> 'APPROVED' or ${t.actorType} = 'USER'`,
    ),
    index('application_events_app_idx').on(t.applicationId, t.createdAt),
  ],
);

/** One read of a source: when, how it went, and what it brought. The screen shows the last few. */
export const sourceRuns = pgTable(
  'source_runs',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => jobSources.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status', { enum: ['OK', 'ERROR'] }).notNull(),
    trigger: text('trigger', { enum: ['MANUAL', 'SCHEDULE'] }).notNull(),
    fetched: integer('fetched').notNull().default(0),
    created: integer('created').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    filtered: integer('filtered').notNull().default(0),
    discarded: integer('discarded').notNull().default(0),
    message: text('message'),
  },
  (t) => [index('source_runs_source_idx').on(t.sourceId, t.startedAt)],
);

export const DOCUMENT_KINDS = ['RESUME', 'COVER_LETTER'] as const;
export const EMAIL_CLASSES = [
  'INTERVIEW_INVITE',
  'ASSESSMENT',
  'OFFER',
  'REJECTION',
  'RECEIPT',
  'OTHER',
] as const;
export type EmailClass = (typeof EMAIL_CLASSES)[number];

/** A generated resume or cover letter; every claim in it carries a verdict and the evidence behind it. */
export const applicationDocuments = pgTable(
  'application_documents',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    kind: text('kind', { enum: DOCUMENT_KINDS }).notNull(),
    version: integer('version').notNull(),
    content: text('content').notNull(),
    claims: jsonb('claims')
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    verdicts: jsonb('verdicts')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    redactions: integer('redactions').notNull().default(0),
    needsReview: boolean('needs_review').notNull().default(false),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check('application_documents_kind', inList(t.kind, DOCUMENT_KINDS)),
    uniqueIndex('application_documents_uq').on(t.applicationId, t.kind, t.version),
    index('application_documents_org_month_idx').on(t.organizationId, t.createdAt),
  ],
);

/** An email from an employer, logged against an application and classified; moving the application is a person's decision. */
export const applicationEmails = pgTable(
  'application_emails',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id),
    fromAddress: text('from_address').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    classification: text('classification', { enum: EMAIL_CLASSES }).notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 2 }).notNull(),
    signals: text('signals')
      .array()
      .notNull()
      .default(sql`'{}'`),
    suggestedState: text('suggested_state', { enum: APPLICATION_STATES }),
    status: text('status', { enum: ['NEW', 'ACTED', 'DISMISSED'] })
      .notNull()
      .default('NEW'),
    decidedBy: uuid('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    check('application_emails_classification', inList(t.classification, EMAIL_CLASSES)),
    index('application_emails_app_idx').on(t.applicationId, t.createdAt),
  ],
);

/** One-time codes that stand in for the authenticator app; only a hash is stored. */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('mfa_recovery_codes_hash_uq').on(t.userId, t.codeHash)],
);

export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'CANCELLED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** An attempt to buy a plan for a workspace. The plan changes only when the provider confirms the payment. */
export const paymentOrders = pgTable(
  'payment_orders',
  {
    id: id(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    plan: text('plan').notNull(),
    provider: text('provider').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('PENDING'),
    providerReference: text('provider_reference'),
    checkoutUrl: text('checkout_url'),
    failure: text('failure'),
    createdAt: createdAt(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => [index('payment_orders_org_idx').on(t.organizationId, t.createdAt)],
);

/** A one-time password recovery link; only the token's hash is stored, and it works once, for an hour. */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('password_resets_hash_uq').on(t.tokenHash),
    index('password_resets_user_idx').on(t.userId),
  ],
);

/** An organization's own credentials, encrypted; the API never returns a value, only that one is set. */
export const organizationSecrets = pgTable(
  'organization_secrets',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id),
    name: text('name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    /** The last four characters, so a person can tell which key is stored without it being readable. */
    hint: text('hint').notNull(),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('organization_secrets_uq').on(t.organizationId, t.name)],
);

export type UserRow = typeof users.$inferSelect;
export type OrganizationRow = typeof organizations.$inferSelect;
export type CandidateProfileRow = typeof candidateProfiles.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type JobSourceRow = typeof jobSources.$inferSelect;
export type ApplicationRow = typeof applications.$inferSelect;
export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
