-- Tenant isolation in the database. Every tenant table carries organization_id, and a policy lets a
-- session see and write only the rows of the organization it declared (`app.organization_id`, set
-- per transaction by the application). The runtime role cannot bypass these policies, and FORCE
-- makes them apply to the table owner too, so a forgotten WHERE clause cannot leak another tenant.

CREATE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.organization_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Tables that belong wholly to one tenant: the same policy for reading and writing.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'audit_logs', 'outbox_events',
    'candidate_profiles', 'candidate_skills', 'candidate_experience', 'candidate_education', 'candidate_projects',
    'job_sources', 'raw_jobs', 'jobs', 'job_matches',
    'applications', 'application_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = app_org()) WITH CHECK (organization_id = app_org())',
      t || '_tenant_isolation', t);
  END LOOP;
END
$$;
--> statement-breakpoint

-- An organization is visible to its members (so a person can list where they belong) and is
-- created by the person who will own it.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_read ON organizations FOR SELECT USING (
  id = app_org()
  OR owner_user_id = app_user()
  OR EXISTS (SELECT 1 FROM organization_members m
              WHERE m.organization_id = organizations.id AND m.user_id = app_user() AND m.status = 'ACTIVE')
);
--> statement-breakpoint
CREATE POLICY organizations_create ON organizations FOR INSERT WITH CHECK (owner_user_id = app_user());
--> statement-breakpoint
CREATE POLICY organizations_change ON organizations FOR UPDATE USING (id = app_org()) WITH CHECK (id = app_org());
--> statement-breakpoint

-- Memberships: a tenant sees its own; a person sees their own across tenants (to choose one at sign-in).
ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_members_read ON organization_members FOR SELECT
  USING (organization_id = app_org() OR user_id = app_user());
--> statement-breakpoint
CREATE POLICY organization_members_write ON organization_members FOR INSERT
  WITH CHECK (organization_id = app_org());
--> statement-breakpoint
CREATE POLICY organization_members_change ON organization_members FOR UPDATE
  USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint

-- Roles: the platform templates (no organization) are readable by everyone; a tenant's own are its own.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY roles_read ON roles FOR SELECT USING (organization_id IS NULL OR organization_id = app_org());
--> statement-breakpoint
CREATE POLICY roles_write ON roles FOR INSERT WITH CHECK (organization_id = app_org());
--> statement-breakpoint
CREATE POLICY roles_change ON roles FOR UPDATE USING (organization_id = app_org()) WITH CHECK (organization_id = app_org());
--> statement-breakpoint

-- The six platform role templates (kept in step with ROLE_PERMISSIONS in the code by a test).
-- The seed runs as the schema owner, which FORCE would otherwise bar from inserting a template.
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
INSERT INTO roles (organization_id, name, permissions) VALUES
  (NULL, 'OWNER', '["organizations:manage","members:invite","members:read","candidates:read","candidates:write","jobs:read","jobs:write","sources:manage","applications:read","applications:write","applications:approve","ai_config:manage","billing:manage","analytics:read","audit:read"]'::jsonb),
  (NULL, 'ADMIN', '["organizations:manage","members:invite","members:read","candidates:read","candidates:write","jobs:read","jobs:write","sources:manage","applications:read","applications:write","applications:approve","ai_config:manage","analytics:read","audit:read"]'::jsonb),
  (NULL, 'RECRUITER', '["members:read","candidates:read","candidates:write","jobs:read","jobs:write","sources:manage","applications:read","applications:write","applications:approve","analytics:read"]'::jsonb),
  (NULL, 'HIRING_MANAGER', '["candidates:read","jobs:read","applications:read","analytics:read"]'::jsonb),
  (NULL, 'ANALYST', '["candidates:read","jobs:read","applications:read","analytics:read"]'::jsonb),
  (NULL, 'CANDIDATE', '["candidates:read","candidates:write","jobs:read","applications:read","applications:write","applications:approve","analytics:read"]'::jsonb);
--> statement-breakpoint
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- What the runtime role may do. The role itself is created by the environment (never by a
-- migration, which would put a password in git); this only grants to it when it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobpilot_app') THEN
    GRANT USAGE ON SCHEMA public TO jobpilot_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO jobpilot_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO jobpilot_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM jobpilot_app;
    REVOKE DELETE, TRUNCATE ON users, organizations, organization_members FROM jobpilot_app;
  END IF;
END
$$;
