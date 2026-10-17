CREATE TABLE "application_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_events_actor" CHECK ("application_events"."actor_type" in ('SYSTEM', 'USER', 'AI_AGENT', 'BROWSER_WORKER')),
	CONSTRAINT "application_events_approval_by_user" CHECK ("application_events"."to_state" <> 'APPROVED' or "application_events"."actor_type" = 'USER')
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"state" text DEFAULT 'DISCOVERED' NOT NULL,
	"state_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"next_action_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_state" CHECK ("applications"."state" in ('DISCOVERED', 'MATCHED', 'SHORTLISTED', 'RESUME_GENERATED', 'COVER_LETTER_GENERATED', 'READY_TO_APPLY', 'APPROVED', 'APPLIED', 'SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'NO_RESPONSE', 'EXPIRED', 'NEEDS_HUMAN_REVIEW')),
	CONSTRAINT "applications_approval_recorded" CHECK ("applications"."state" not in ('APPROVED', 'APPLIED', 'SCREENING', 'INTERVIEW', 'FINAL_INTERVIEW', 'OFFER', 'ACCEPTED') or "applications"."approved_by" is not null)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"prev_hash" text NOT NULL,
	"self_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_education" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"degree" text NOT NULL,
	"field" text,
	"start_date" date,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_experience" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"title" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"description" text,
	"technologies" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_experience_dates" CHECK ("candidate_experience"."end_date" is null or "candidate_experience"."end_date" >= "candidate_experience"."start_date")
);
--> statement-breakpoint
CREATE TABLE "candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"headline" text,
	"summary" text,
	"target_roles" text[] DEFAULT '{}' NOT NULL,
	"target_locations" text[] DEFAULT '{}' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"work_auth_status" text DEFAULT 'OTHER' NOT NULL,
	"remote_pref" text DEFAULT 'FLEXIBLE' NOT NULL,
	"relocation_ok" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_profiles_work_auth" CHECK ("candidate_profiles"."work_auth_status" in ('CITIZEN', 'PERMANENT_RESIDENT', 'VISA_HOLDER', 'NEEDS_SPONSORSHIP', 'OTHER')),
	CONSTRAINT "candidate_profiles_remote_pref" CHECK ("candidate_profiles"."remote_pref" in ('REMOTE_ONLY', 'HYBRID', 'ONSITE', 'FLEXIBLE')),
	CONSTRAINT "candidate_profiles_salary_range" CHECK ("candidate_profiles"."salary_min" is null or "candidate_profiles"."salary_max" is null or "candidate_profiles"."salary_min" <= "candidate_profiles"."salary_max")
);
--> statement-breakpoint
CREATE TABLE "candidate_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"technologies" text[] DEFAULT '{}' NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candidate_skills" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"skill_name" text NOT NULL,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"proficiency" text DEFAULT 'INTERMEDIATE' NOT NULL,
	"years_experience" numeric(4, 1),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_skills_category" CHECK ("candidate_skills"."category" in ('FRONTEND', 'BACKEND', 'DATABASE', 'DEVOPS', 'SOFT', 'OTHER')),
	CONSTRAINT "candidate_skills_proficiency" CHECK ("candidate_skills"."proficiency" in ('BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'))
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"candidate_profile_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"overall_score" numeric(5, 2) NOT NULL,
	"technical_score" numeric(5, 2) NOT NULL,
	"location_score" numeric(5, 2) NOT NULL,
	"salary_score" numeric(5, 2) NOT NULL,
	"seniority_score" numeric(5, 2) NOT NULL,
	"missing_skills" text[] DEFAULT '{}' NOT NULL,
	"strong_evidence" text[] DEFAULT '{}' NOT NULL,
	"hard_filters" text[] DEFAULT '{}' NOT NULL,
	"recommendation" text NOT NULL,
	"scoring_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_matches_recommendation" CHECK ("job_matches"."recommendation" in ('APPLY', 'MAYBE', 'SKIP')),
	CONSTRAINT "job_matches_scores" CHECK ("job_matches"."overall_score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"poll_interval_minutes" integer DEFAULT 60 NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_status" text,
	"last_run_message" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sources_type" CHECK ("job_sources"."type" in ('RSS', 'GREENHOUSE')),
	CONSTRAINT "job_sources_poll" CHECK ("job_sources"."poll_interval_minutes" between 5 and 10080)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text,
	"remote_type" text DEFAULT 'ONSITE' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"seniority" text,
	"employment_type" text DEFAULT 'FULL_TIME' NOT NULL,
	"required_skills" text[] DEFAULT '{}' NOT NULL,
	"preferred_skills" text[] DEFAULT '{}' NOT NULL,
	"visa_sponsorship" boolean,
	"application_url" text,
	"deadline_at" timestamp with time zone,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedup_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_remote_type" CHECK ("jobs"."remote_type" in ('REMOTE', 'HYBRID', 'ONSITE')),
	CONSTRAINT "jobs_status" CHECK ("jobs"."status" in ('ACTIVE', 'EXPIRED', 'CLOSED')),
	CONSTRAINT "jobs_salary_range" CHECK ("jobs"."salary_min" is null or "jobs"."salary_max" is null or "jobs"."salary_min" <= "jobs"."salary_max"),
	CONSTRAINT "jobs_url_scheme" CHECK ("jobs"."application_url" is null or "jobs"."application_url" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'FREE' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "raw_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"raw_payload" jsonb NOT NULL,
	"dedup_hash" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"permissions" jsonb NOT NULL,
	CONSTRAINT "roles_name_valid" CHECK ("roles"."name" in ('OWNER', 'ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'ANALYST', 'CANDIDATE'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" = lower("users"."email"))
);
--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_experience" ADD CONSTRAINT "candidate_experience_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_projects" ADD CONSTRAINT "candidate_projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_projects" ADD CONSTRAINT "candidate_projects_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_candidate_profile_id_candidate_profiles_id_fk" FOREIGN KEY ("candidate_profile_id") REFERENCES "public"."candidate_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_jobs" ADD CONSTRAINT "raw_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_jobs" ADD CONSTRAINT "raw_jobs_source_id_job_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."job_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_events_app_idx" ON "application_events" USING btree ("application_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "applications_uq" ON "applications" USING btree ("candidate_profile_id","job_id");--> statement-breakpoint
CREATE INDEX "applications_org_state_idx" ON "applications" USING btree ("organization_id","state");--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "candidate_education_profile_idx" ON "candidate_education" USING btree ("candidate_profile_id");--> statement-breakpoint
CREATE INDEX "candidate_experience_profile_idx" ON "candidate_experience" USING btree ("candidate_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_profiles_uq" ON "candidate_profiles" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "candidate_projects_profile_idx" ON "candidate_projects" USING btree ("candidate_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_skills_uq" ON "candidate_skills" USING btree ("candidate_profile_id",lower("skill_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "companies_normalized_uq" ON "companies" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "job_matches_uq" ON "job_matches" USING btree ("candidate_profile_id","job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_sources_name_uq" ON "job_sources" USING btree ("organization_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedup_uq" ON "jobs" USING btree ("organization_id","dedup_hash");--> statement-breakpoint
CREATE INDEX "jobs_org_status_idx" ON "jobs" USING btree ("organization_id","status","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_uq" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "raw_jobs_status_idx" ON "raw_jobs" USING btree ("status","fetched_at");--> statement-breakpoint
CREATE INDEX "raw_jobs_hash_idx" ON "raw_jobs" USING btree ("dedup_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_template_uq" ON "roles" USING btree ("name") WHERE "roles"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");