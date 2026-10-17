# ADR 0004: the web app keeps sessions on the server and gives approval its own card

Status: accepted

## Decision

- **Tokens never reach page JavaScript.** Both live in `httpOnly` cookies set by the web server;
  server components call the API with them, and browser code calls one route handler, `/bff`, which
  adds the token. `proxy.ts` renews the short-lived access token before a page renders, and
  concurrent requests that carry the same refresh token share one refresh, because the API treats a
  reused, already-rotated token as theft and revokes the family. Prefetches never refresh.
- **Sign-in has two steps when it must.** A person who belongs to several organizations gets a
  choice screen (the API returns a selection token and the list); one organization signs in
  directly. The chosen organization is in the token, so every later request is scoped to it.
- **Only the landing page is public** (and indexed). Everything else is a private workspace:
  `noindex`, redirects to sign-in with a same-site `next`, and `robots.txt` that allows only `/`.
- **The interface follows permissions, the API enforces them.** The menu, buttons and pages are
  driven by the permission list the API returns for the signed-in person; a missing permission
  hides the control, and the API still refuses the call.
- **Approval is its own card, never a button among buttons.** The one step nothing but a person may
  take is shown only when the application is ready and the person holds the approval permission, in
  words that say what approving means, and it asks for confirmation. The other moves are a separate
  "Move it to" list, and the `APPROVED` state is deliberately absent from it so approval cannot be
  reached sideways.
- **A score is shown with its parts.** Every match shows the four component scores, what is missing,
  what is strong and any hard filter that ruled the job out, so the person can disagree knowingly.

## Consequences

- Refresh de-duplication is per web-server process; several instances need sticky sessions.
- A role whose permissions are changed keeps the old list until its access token is renewed (at most
  the access-token lifetime).
