-- The outbox gets a dispatcher, and people get notifications.
--
-- The dispatcher has to read events of every tenant, which row-level security forbids by design. It is
-- allowed ONE narrow thing: with `app.dispatcher = 'on'` set for the transaction it may read pending
-- events and mark them dispatched. It cannot read or write any other table that way; everything an
-- event causes is done inside the event's own tenant (the same `app.organization_id` mechanism as a
-- request), so the isolation guarantee for tenant data is unchanged.

CREATE FUNCTION app_dispatcher() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.dispatcher', true), '') = 'on'
$$;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "last_error" text;
--> statement-breakpoint
DROP INDEX IF EXISTS "outbox_pending_idx";
--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status", "next_attempt_at", "id");
--> statement-breakpoint
CREATE POLICY outbox_events_dispatcher ON outbox_events FOR ALL
  USING (app_dispatcher()) WITH CHECK (app_dispatcher());
--> statement-breakpoint

CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL DEFAULT '',
	"link" text,
	"event_id" bigint,
	"read_at" timestamp with time zone,
	"email_status" text NOT NULL DEFAULT 'NOT_SENT',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_email_status" CHECK ("email_status" in ('NOT_SENT', 'SENT', 'FAILED', 'SKIPPED')),
	CONSTRAINT "notifications_link_local" CHECK ("link" is null or "link" ~ '^/')
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id");
--> statement-breakpoint
-- One notification per person per event: a retried dispatch cannot tell them twice.
CREATE UNIQUE INDEX "notifications_event_user_uq" ON "notifications" ("event_id", "user_id") WHERE "event_id" is not null;
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "created_at" DESC);
--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_tenant_isolation ON notifications
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON notifications TO jobpilot_app;
  END IF;
END
$$;
