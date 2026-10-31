-- Job sources grow up: many more kinds of source, per-source filters, an automatic schedule with back-off,
-- and a history of every read.

ALTER TABLE "job_sources" DROP CONSTRAINT "job_sources_type";
--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_type" CHECK ("type" in (
  'RSS', 'GREENHOUSE', 'LEVER', 'ASHBY', 'WORKABLE', 'SMARTRECRUITERS', 'RECRUITEE', 'BREEZY', 'PERSONIO', 'BAMBOOHR',
  'WORKDAY', 'REMOTIVE', 'REMOTEOK', 'HIMALAYAS', 'ARBEITNOW', 'JOBICY', 'HACKERNEWS', 'GOOGLE_CAREERS',
  'STRUCTURED_DATA', 'JSON_API', 'HTML_LIST'
));
--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "filters" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "preset_id" text;
--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "next_run_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "job_sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX "job_sources_due_idx" ON "job_sources" ("enabled", "next_run_at");
--> statement-breakpoint

-- The scheduler has to find due sources in every tenant. Like the outbox, it gets one narrow door: with
-- `app.dispatcher = 'on'` it may read and mark job sources; the reading itself is then done inside the
-- source's own tenant, exactly like a request.
CREATE POLICY job_sources_dispatcher ON job_sources FOR ALL
  USING (app_dispatcher()) WITH CHECK (app_dispatcher());
--> statement-breakpoint

CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"filtered" integer DEFAULT 0 NOT NULL,
	"discarded" integer DEFAULT 0 NOT NULL,
	"message" text,
	CONSTRAINT "source_runs_status" CHECK ("status" in ('OK', 'ERROR')),
	CONSTRAINT "source_runs_trigger" CHECK ("trigger" in ('MANUAL', 'SCHEDULE'))
);
--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "job_sources"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "source_runs_source_idx" ON "source_runs" ("source_id", "started_at" DESC);
--> statement-breakpoint
ALTER TABLE source_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE source_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY source_runs_tenant_isolation ON source_runs
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON source_runs TO jobpilot_app;
  END IF;
END
$$;
