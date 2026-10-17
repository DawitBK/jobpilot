# JobPilot

A multi-tenant job-search platform: a candidate's career graph, jobs pulled from public feeds,
a transparent matching engine, and applications that move through a state machine in which **only a
person can approve a submission**. Built so that one organization can never see another's data, and
so that the audit trail proves it was not edited.

> **Status:** the API foundation and the web app (profile, jobs, matches, the application pipeline,
> sources, team, audit). The AI gateway, resume and cover-letter generation, the
> policy-gated browser worker, email intelligence and billing are specified and not built yet; see
> the [enterprise bar](docs/enterprise-bar.md) for exactly what exists and what does not.

## What it does

| Area         | Behaviour                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy      | people belong to many organizations with a role in each; sign in asks which one; every tenant table is protected by **row-level security**                      |
| Access       | six roles and `resource:action` permissions carried in a short-lived token; rotating refresh tokens with reuse detection; removing a member ends their sessions |
| Career graph | profile, skills, experience, education, projects; years of experience computed without double-counting overlapping jobs                                         |
| Discovery    | RSS/Atom and Greenhouse connectors, raw postings kept, normalised (salary, seniority, remote, visa, skills), de-duplicated, with SSRF-safe fetching             |
| Matching     | a pure, reproducible score (skills, location, salary, seniority) with hard filters that always win; a good match opens an application                           |
| Applications | an 18-state machine; approval is its own action, by a person only, recorded with who and when                                                                   |
| Evidence     | audit trail as a hash chain you can verify; every change also announces itself in a transactional outbox                                                        |

## The guarantees (and the test that proves each)

- **Tenant isolation is enforced by the database.** The app connects as a role that cannot bypass
  row-level security; a session with no tenant sees nothing, a session sees only its own tenant even
  with no `WHERE` clause, and writes into another tenant are refused (`tenancy.int.test.ts`).
- **The browser worker and the AI cannot approve.** The engine refuses any non-person actor, a CHECK
  constraint refuses to store such an event, and another refuses an approved state with nobody
  recorded as approving it (`applications.int.test.ts`).
- **The audit trail shows tampering.** Each row's hash covers the previous one; rewriting history
  breaks the chain at that row, and the table is append-only (`tenancy.int.test.ts`).
- **Hard filters win.** A job the candidate cannot take (no visa sponsorship, on-site outside their
  locations) is a SKIP however well the skills match (`domain.test.ts`, `jobs.int.test.ts`).
- **A feed cannot reach your network.** Feed URLs must be public https; private, loopback and
  link-local addresses are refused, and redirects are re-checked (`domain.test.ts`).

## Stack

Node 24, NestJS 12, Drizzle ORM, PostgreSQL 18, Zod contracts that generate the OpenAPI document,
Vitest, pnpm 10 and Turborepo. Decisions are in [docs/adr](docs/adr).

## Run it

```sh
corepack enable
pnpm install
pnpm db:up                       # PostgreSQL 18 in Docker
cp .env.example .env             # read the note about the two database roles first
pnpm build
pnpm --filter @jobpilot/api db:migrate      # as the owner role (MIGRATION_DATABASE_URL)
pnpm --filter @jobpilot/api start           # as the runtime role (DATABASE_URL)
```

Sign up with `POST /api/v1/auth/register`: that creates your account and a personal workspace you
own. The contract is at `http://localhost:3000/openapi.json`.

## Test it

```sh
pnpm lint && pnpm typecheck && pnpm test
MIGRATION_DATABASE_URL=postgres://jobpilot:jobpilot@localhost:5432/jobpilot_test \
DATABASE_URL=postgres://jobpilot_app:jobpilot_app@localhost:5432/jobpilot_test \
  pnpm test:integration
```

The integration suite creates the `jobpilot_app` role, recreates its database (which must be named
`*_test`), and refuses to run if the runtime role could bypass row-level security.

## Layout

```
apps/api/        the HTTP API (NestJS)
apps/web/        the web app (Next.js; ADR 0004)
packages/kit/    shared building blocks: env, logging, problem+json, pagination, health, OpenAPI
packages/config/ shared TypeScript and ESLint presets
docs/            ADRs and the enterprise-bar scorecard
```

Licensed under Apache-2.0.
