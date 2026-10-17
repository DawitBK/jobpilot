# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub:
**Security tab > Report a vulnerability** on this repository.

Do not open a public issue for a vulnerability. Include what you found, how to reproduce it and
the affected version or commit. You can expect an acknowledgement within a few days.

## Scope and status

Controls in the API today: tenant isolation by row-level security under a role that cannot bypass
it, default-deny authorization with permissions carried in the token, argon2id password hashing,
rotating refresh tokens with reuse detection, sessions ended when a member is removed, strict input
validation, public-https-only feed fetching with redirect checks, a tamper-evident audit trail, and
a rule that only a person can approve an application (enforced in code and in the database).

Known gaps, listed honestly in the [enterprise bar](docs/enterprise-bar.md): no MFA yet, no
sign-in rate limiting or lockout, feed fetching resolves a host's address before connecting (a DNS
rebinding race is possible until it connects to the checked address), and the AI gateway, secrets
service, policy engine and browser worker are not built.

## Practices

- No secrets in the repository; CI runs gitleaks on every push.
- Workflow permissions are read-only by default, and third-party actions are pinned by commit SHA.
- Dependencies are locked (`pnpm-lock.yaml`) and installed with `--frozen-lockfile`.
