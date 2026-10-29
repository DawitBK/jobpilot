# Runbook

## Start a development stack

```sh
pnpm install
pnpm db:up            # or any PostgreSQL 16+; on versions before 18 run `pnpm db:dev` once (defines uuidv7())
cp .env.example .env  # fill in MIGRATION_DATABASE_URL, DATABASE_URL (the non-bypass role), JWT_SECRET, SECRETS_KEY
pnpm build && pnpm --filter @jobpilot/api db:migrate
pnpm dev              # the API on :3000 and the web app on :3031
```

## Demo data

```sh
pnpm seed             # needs the API running; SEED_PASSWORD (12+ characters) is required unless the API is local
```

The seed signs in as the people it creates and uses only the public API, so every rule holds (validation, row-level
security, the state machine, the audit chain, the outbox). It is safe to run again: people, memberships, jobs and profile
entries that exist are left alone and an application that has already moved is not moved again. Nothing is deleted.
Against an API with sign-in rate limiting on it waits out the limit (a few minutes); on a development machine set
`RATE_LIMIT=off` for the API.

What you get: two agencies (Northwind Talent Partners on the Team plan with all six roles and four candidates; Globex
Recruiting, to prove isolation and to give one person two workspaces to choose from), full career graphs, 27 jobs (strong
fits, near misses, hard-filter blockers, noise, closed and expired), a failed job source, 32 applications at every stage of
the pipeline, hand-written resumes and cover letters, employer emails classified by the real classifier, review rules,
notifications (some read), and a valid audit chain. `olivia.owner@northwind-talent.test` owns the agency; every account uses
the seed password. `new.user@northwind-talent.test` has nothing: the empty state.

## Checks

```sh
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test
MIGRATION_DATABASE_URL=... DATABASE_URL=... pnpm test:integration   # database named *_test
pnpm smoke                                                           # the built API and web app, end to end (CI runs it)
WEB_URL=http://127.0.0.1:3031 API_URL=http://127.0.0.1:3000 pnpm test:e2e   # real browser, against a running seeded stack
```

## Operations

- **Outbox**: `outbox_events` rows are handled by the dispatcher inside the API (`SKIP LOCKED`, several instances are
  safe). A failing event retries after 5 s, 20 s, 80 s, 5 min and then stays `FAILED` with `last_error`. Look at them with
  `select event_type, attempts, last_error from outbox_events where status <> 'DISPATCHED'`.
- **Plans** are limits only: no payment provider is connected, so changing a plan takes effect at once and charges nothing.
- **Secrets**: losing `SECRETS_KEY` makes stored two-step secrets and stored AI keys unreadable (people then sign in with
  a recovery code and set it up again). Back the key up separately from the database.
- **AI**: without a key, AI writing answers 503 "not set up" and people write documents themselves.
- **Password recovery and change.** `POST /auth/forgot-password` mails a one-time link (valid one hour, only its hash is stored,
  three per address per hour, the same answer for every address); `POST /auth/reset-password` sets the password, ends every
  session and lifts a sign-in lock; `POST /me/password` changes your own (current password required, every session ends).
  An account that signs in through the identity provider gets no recovery link and cannot change a local password: the
  provider decides who may sign in, and a local password would be a way around it. Without a mail server (`SMTP_URL`) no link
  can be sent, so recovery needs mail in production: set `SMTP_URL`, `MAIL_FROM` and `APP_URL`.
- **Mail in development and CI**: set `MAIL_OUTBOX_DIR=<folder>` and every email becomes a text file there (refused when
  `NODE_ENV=production`). The browser journeys read the recovery link from it. Email verification at registration is not built.
