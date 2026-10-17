# ADR-0001: Tenant isolation is enforced by PostgreSQL, not by remembering a WHERE clause

**Status:** accepted

A multi-tenant system fails the day one query forgets `where organization_id = ...`. So the
application does not carry that burden alone:

- Every tenant table has an `organization_id` and a row-level security policy that compares it with
  `app.organization_id`, a setting the application makes **per transaction** (`set_config(..., true)`,
  which, unlike `SET LOCAL`, accepts bind parameters). The policy covers reads and writes
  (`USING` and `WITH CHECK`), and `FORCE ROW LEVEL SECURITY` applies it to the table owner too.
- The application connects as `jobpilot_app`, a role that is neither superuser nor `BYPASSRLS`.
  Migrations run as the owner role, separately. The test suite creates both roles and **refuses to
  run if the runtime role could bypass**, because tenant tests that run as a superuser prove nothing.
- All tenant work goes through `TenantDb.inTenant(scope, work)`; there is no other way to reach a
  tenant table from a service. A session with no tenant sees nothing at all.

Global data is kept deliberately small: `users` (a person is one row, in no tenant), the platform
role templates, `companies` (reference data shared by all tenants) and `refresh_tokens` (looked up by
the hash of a secret). Before an organization is chosen (sign-up, sign-in) a session declares only
`app.user_id`, which lets it see that person's memberships and nothing else.

**Rejected:** a schema or database per tenant (operational weight that this scale does not justify),
application-level filtering alone (the failure mode above).
