-- Generated application documents (with the evidence behind every claim) and employer emails logged against
-- an application. Both belong wholly to one tenant, like every other table in this schema.

CREATE TABLE "application_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	-- Every claim the document makes, with its verdict and the evidence found in the candidate's own record.
	"claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verdicts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"redactions" integer DEFAULT 0 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_documents_kind" CHECK ("kind" in ('RESUME', 'COVER_LETTER')),
	CONSTRAINT "application_documents_version" CHECK ("version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "application_documents_uq" ON "application_documents" ("application_id", "kind", "version");
--> statement-breakpoint
CREATE INDEX "application_documents_org_month_idx" ON "application_documents" ("organization_id", "created_at");
--> statement-breakpoint

CREATE TABLE "application_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"classification" text NOT NULL,
	"confidence" numeric(4, 2) NOT NULL,
	"signals" text[] DEFAULT '{}' NOT NULL,
	"suggested_state" text,
	-- NEW: waiting for a person; ACTED: a person applied the suggested move; DISMISSED: a person said no.
	"status" text DEFAULT 'NEW' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_emails_classification" CHECK ("classification" in ('INTERVIEW_INVITE', 'ASSESSMENT', 'OFFER', 'REJECTION', 'RECEIPT', 'OTHER')),
	CONSTRAINT "application_emails_status" CHECK ("status" in ('NEW', 'ACTED', 'DISMISSED')),
	CONSTRAINT "application_emails_confidence" CHECK ("confidence" between 0 and 1)
);
--> statement-breakpoint
ALTER TABLE "application_emails" ADD CONSTRAINT "application_emails_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "application_emails" ADD CONSTRAINT "application_emails_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "applications"("id");
--> statement-breakpoint
CREATE INDEX "application_emails_app_idx" ON "application_emails" ("application_id", "created_at");
--> statement-breakpoint

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['application_documents', 'application_emails'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = app_org()) WITH CHECK (organization_id = app_org())',
      t || '_tenant_isolation', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO jobpilot_app', t);
    END IF;
  END LOOP;
END
$$;
