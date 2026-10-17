# ADR-0002: Only a person can approve, and the audit trail proves it

**Status:** accepted

The point of an assisted job-application agent is that a human decision stands between "the system
prepared this" and "the system acted on it". That line is drawn where it cannot be argued with:

1. **The engine.** `validateTransition` refuses the move to `APPROVED` for any actor that is not a
   `USER`: the browser worker, the AI and the system are structurally unable to authorise a
   submission.
2. **The database.** A CHECK constraint on `application_events` refuses to store an `APPROVED` event
   by any other actor, and one on `applications` refuses an approved (or later) state with nobody
   recorded as approving it. Code that bypassed the engine still could not write the record.
3. **A separate call.** Approval is `POST /applications/{id}/approve`; the general transition
   endpoint refuses `APPROVED`, so it cannot happen by accident. A candidate may approve only their
   own applications.

Every transition runs in one transaction that locks the application, validates the move, changes
the state, writes the event, writes the outbox row and appends to the audit trail.

The audit trail is a per-tenant **hash chain**: each row stores the hash of the previous one and a
hash of its own content (taken over key-sorted JSON, because `jsonb` does not keep key order). The
chain is extended under a per-tenant advisory lock so concurrent writers cannot fork it, the table
rejects UPDATE, DELETE and TRUNCATE, and `GET /audit/verify` recomputes the chain and names the first
row that does not hold. A test switches the trigger off as the owner, rewrites a row, and watches
verification fail at that row.

**Limits, stated plainly:** the chain proves that history was not changed _within_ the database; it
does not stop someone with owner access from deleting the whole tenant's trail and starting a fresh
chain. Exporting chain heads to an external store is the next step if that matters.
