-- Two-factor sign-in, an encrypted store for an organization's own credentials, and the organization's review policy.

-- MFA lives on the person (users is global, like the password hash). The secret is stored encrypted
-- (AES-256-GCM, key from the environment); `totp_enabled_at` is null until the person proved they hold it.
ALTER TABLE "users" ADD COLUMN "totp_secret_enc" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp with time zone;
--> statement-breakpoint
-- The last time step that was accepted: a code that was already used cannot be used again.
ALTER TABLE "users" ADD COLUMN "totp_last_step" bigint;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_totp_enabled_needs_secret" CHECK ("totp_enabled_at" is null or "totp_secret_enc" is not null);
--> statement-breakpoint

CREATE TABLE "mfa_recovery_codes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "mfa_recovery_codes_hash_uq" ON "mfa_recovery_codes" ("user_id", "code_hash");
--> statement-breakpoint

-- An organization's own credentials (for example its AI provider key). Only ciphertext is stored; the API never returns a value.
CREATE TABLE "organization_secrets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"hint" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "organization_secrets" ADD CONSTRAINT "organization_secrets_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_secrets_uq" ON "organization_secrets" ("organization_id", "name");
--> statement-breakpoint
ALTER TABLE organization_secrets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_secrets FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_secrets_tenant_isolation ON organization_secrets
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint

-- What the organization wants a person to look at before an application goes on (see policy.ts); empty means the defaults.
ALTER TABLE "organizations" ADD COLUMN "policy" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO jobpilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON organization_secrets TO jobpilot_app;
  END IF;
END
$$;
