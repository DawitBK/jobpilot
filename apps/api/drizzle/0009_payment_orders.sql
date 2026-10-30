-- Paying for a plan: one row per attempt to buy a plan for a workspace. The plan changes only when the payment provider
-- confirms (server to server) that this order was paid; the row says who asked, for what, through which provider, and how it ended.
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"plan" text NOT NULL,
	"provider" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_reference" text,
	"checkout_url" text,
	"failure" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payment_orders_amount_positive" CHECK ("amount_minor" > 0),
	CONSTRAINT "payment_orders_status_valid" CHECK ("status" IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED')),
	CONSTRAINT "payment_orders_paid_has_time" CHECK ("status" <> 'PAID' OR "paid_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_requested_by_fk" FOREIGN KEY ("requested_by") REFERENCES "users"("id");
--> statement-breakpoint
CREATE INDEX "payment_orders_org_idx" ON "payment_orders" ("organization_id", "created_at" DESC);
--> statement-breakpoint

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_orders FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payment_orders_tenant_isolation ON payment_orders
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint
-- A payment provider's webhook arrives with an order id and nothing else (no session, no tenant). It is allowed ONE narrow
-- thing: with `app.payment_lookup` set to an order id for the transaction, read that one row, to learn which workspace it is
-- for. Everything after that happens inside that workspace, under the ordinary policy above.
CREATE POLICY payment_orders_webhook_lookup ON payment_orders FOR SELECT
  USING (id::text = coalesce(current_setting('app.payment_lookup', true), ''));
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT SELECT, INSERT, UPDATE ON payment_orders TO jobpilot_app;
  END IF;
END
$$;
