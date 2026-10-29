-- Password recovery: a one-time link mailed to the person. Only a hash of the token is stored, so a copy of the
-- database cannot be used to take over an account; a token works once and for one hour.
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
CREATE UNIQUE INDEX "password_resets_hash_uq" ON "password_resets" ("token_hash");
--> statement-breakpoint
CREATE INDEX "password_resets_user_idx" ON "password_resets" ("user_id");
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON password_resets TO jobpilot_app;
  END IF;
END
$$;
