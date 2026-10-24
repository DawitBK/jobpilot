# Container image

The API (`apps/api`) ships as one image, built from the `Dockerfile` in the repository root. The web
app is deployed separately and is not in it. The same image runs the API and the database
migrations; only the command differs.

## Build

From the repository root (the build context):

```sh
docker build -t jobpilot-api .
```

The image is built in stages: Node 24 (slim, version pinned in the `Dockerfile`) with the pnpm
version from `packageManager` in `package.json` (through corepack), `pnpm install --frozen-lockfile`,
a build of the API and `@jobpilot/kit` only, then `pnpm deploy --prod` to a pruned production tree. The
final image holds production dependencies, the compiled code (`dist/`, no source maps) and the SQL
migrations (`drizzle/`). It runs as the unprivileged `node` user with `NODE_ENV=production`.

## Two database roles

JobPilot isolates tenants with row-level security, so it uses two roles on one database:

- the **owner** role owns the schema and runs the migrations (`MIGRATION_DATABASE_URL`);
- the **runtime** role is what the API connects as (`DATABASE_URL`). It must be neither a superuser
  nor `BYPASSRLS`, or the policies do not apply to it.

The runtime role must be named `jobpilot_app` and must exist **before the first migration**: the
row-level security migration grants it table privileges only if it is already there.

## Run

Migrate first, then start the API. Both read their settings from the environment (see below); pass
them with `-e` or `--env-file`.

```sh
# 1. Apply the migrations as the owner role (safe to repeat), then exit.
docker run --rm --env-file <env-file> jobpilot-api node dist/db/migrate.js

# 2. Start the API (connects as the runtime role).
docker run -d --name jobpilot-api --env-file <env-file> -p <host-port>:<PORT> jobpilot-api
```

`<PORT>` is the value of `PORT` (default 3000). The migration command needs only
`MIGRATION_DATABASE_URL`; the API needs only `DATABASE_URL`. One env file can hold both.

## Health

| Path                | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `GET /health/live`  | The process is up. Never touches the database.                             |
| `GET /health/ready` | 200 only while the API can reach its database (`select 1`), otherwise 503. |

The image `HEALTHCHECK` calls `/health/ready` on `PORT` every 30 seconds (20 seconds of start-up
grace), using Node, so no extra tools are in the image. Neither path is rate limited.

## Environment variables

| Variable                    | Required      | Default                            | Meaning                                                                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`              | yes (API)     |                                    | `postgres://` URL of the database as the runtime role (`jobpilot_app`).                                                                                                                                                                                                                                                                 |
| `MIGRATION_DATABASE_URL`    | yes (migrate) |                                    | `postgres://` URL of the same database as the owner role. Read only by `node dist/db/migrate.js`.                                                                                                                                                                                                                                       |
| `JWT_SECRET`                | yes (API)     |                                    | HMAC key for access tokens, at least 32 characters.                                                                                                                                                                                                                                                                                     |
| `PORT`                      | no            | 3000 (`ARG PORT`, also `ENV PORT`) | Port the API listens on (all interfaces). Change it at build time with `--build-arg PORT=...` or at run time.                                                                                                                                                                                                                           |
| `NODE_ENV`                  | no            | `production` (set in the image)    | Leave as is.                                                                                                                                                                                                                                                                                                                            |
| `LOG_LEVEL`                 | no            | `info`                             | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`.                                                                                                                                                                                                                                                                         |
| `TRUST_PROXY_HOPS`          | no            | `0`                                | How many reverse proxies sit in front of the API. Only then is `X-Forwarded-For` believed (rate limiting uses it).                                                                                                                                                                                                                      |
| `OIDC_ISSUER`               | no            |                                    | Single sign-on: issuer URL. Set all three of `OIDC_ISSUER`, `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`, or none.                                                                                                                                                                                                                         |
| `OIDC_CLIENT_ID`            | no            |                                    | Single sign-on: client id.                                                                                                                                                                                                                                                                                                              |
| `OIDC_CLIENT_SECRET`        | no            |                                    | Single sign-on: client secret.                                                                                                                                                                                                                                                                                                          |
| `OIDC_INTERNAL_URL`         | no            |                                    | Single sign-on, optional: where the API itself reaches the identity provider, for example `http://sso:7300` (an absolute http or https URL, no trailing slash). When set, discovery, token, userinfo and signing keys are fetched from there, while `OIDC_ISSUER` stays the public address people use. Browser addresses are unchanged. |
| `ACCESS_TOKEN_TTL_SECONDS`  | no            | `900`                              | Access token lifetime, 60 to 3600.                                                                                                                                                                                                                                                                                                      |
| `REFRESH_TOKEN_TTL_SECONDS` | no            | `1209600`                          | Refresh token lifetime, at least 3600.                                                                                                                                                                                                                                                                                                  |
| `RATE_LIMIT`                | no            | on                                 | `on` or `off`.                                                                                                                                                                                                                                                                                                                          |

Nothing else is read. The image contains no secret, host or credential. With single sign-on set,
the API reaches the provider (`OIDC_INTERNAL_URL` when set, otherwise `OIDC_ISSUER`) over the network at sign-in, and the job-source connectors fetch
postings from the boards they are configured for, so the container needs outbound HTTPS.
