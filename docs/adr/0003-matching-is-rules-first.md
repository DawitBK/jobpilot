# ADR-0003: Matching is rules first, reproducible, and hard filters always win

**Status:** accepted

A candidate needs to know why a job scored what it did. The score is a pure function
(`matching/score.ts`) of the candidate's facts and the job's facts, so it is reproducible, testable
and explainable:

| Part      | Weight | How it is worked out                                                                                         |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| technical | 45%    | share of required skills held (75%) and preferred skills held (25%), with aliases ("JS", "node", "postgres") |
| location  | 20%    | candidate's remote preference against the job's arrangement, capped when the place is wrong                  |
| seniority | 20%    | distance between the level the years of experience suggest and the job's level                               |
| salary    | 15%    | how far the job's range reaches into what the candidate needs; neutral when either side is silent            |

`APPLY` from 80, `MAYBE` from 60, `SKIP` below. **Hard filters decide first**: needing sponsorship
for a job that offers none, an on-site job outside the candidate's locations when they will not
relocate, an on-site job for someone who wants remote only. A filtered job is a SKIP with the filter
named, whatever its other scores; nothing downstream, including the AI layer to come, may override it.

A match that is not a SKIP opens an application once. A job is the same job whatever feed it arrives
by: its identity is a hash of the normalised company, title and place, unique per tenant, so
re-polling a source never duplicates.

**Deferred on purpose:** experience, industry and career-direction scores need a language model or
embeddings; they arrive with the AI gateway as a bounded adjustment on top of this score, never a
replacement. The scoring version (`rules-1`) is stored on every match so old scores stay
interpretable when that changes.
