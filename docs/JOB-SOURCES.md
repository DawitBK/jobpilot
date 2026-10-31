# Job sources

JobPilot finds jobs by reading **sources**. A source is read on its own schedule (every 5 minutes to 7 days, default 60), keeps only what its filters allow, de-duplicates against everything already on file, and scores each new job against every candidate in the workspace.

Open **Job sources → Add a source** to see the catalog. Every entry says how it can honestly be used:

| Label | Meaning |
| --- | --- |
| **Open feed** | The site publishes an open feed or interface for exactly this. Pick it, fill in an account or a keyword, add it. |
| **You set it up** | Works with any site that publishes structured data, a JSON API, an RSS feed or a plain listing page. You give the address and, for a listing page, say which part is the title and company. |
| **Add from links** | No open feed, and the site's terms forbid automated collection (LinkedIn, Glassdoor, Indeed, Bayt) or the site hides its data behind a key (Hahu). JobPilot does not scrape them: paste a job's link, several links, or a whole job-alert email under **Add jobs from links** and each job is read from its page. |

Every source can be **tried before it is added** ("Test it"): you see how many jobs it would bring, how many your filters keep, and a sample. Nothing is saved by a test.

## What is in the catalog (35 entries)

Checked against the real sites on 2026-10-31 with `node scripts/sources-live-check.mjs` (build the API first). The "Checked" date on each card is the day it last read real jobs.

- **Remote and global**: Remotive, Remote OK, Himalayas, We Work Remotely, Arbeitnow, Jobicy, Hacker News "Who is hiring?"
- **Africa and Ethiopia**: EthioJobs, MyJobMag (Nigeria, Kenya), a configurable "another African job board" (Jobs in Africa, Bank jobs, Careers24, Jobberman, BrighterMonday and similar: any site that publishes JobPosting data), Hahu (links only)
- **Humanitarian**: ReliefWeb
- **Large employers**: Google Careers, NVIDIA (Workday)
- **A company's own careers site**: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee, Breezy HR, Personio, BambooHR, Workday, Teamtailor, Pinpoint
- **Niche and custom**: any RSS or Atom feed, any site that publishes job data for Google (page or sitemap), any JSON API (field paths, optional Next.js embedded data), any listing page (CSS selectors)
- **Links only**: LinkedIn, Glassdoor, Indeed, Bayt

BambooHR's interface answers correctly, but no account we could find had an open job to prove a full read with; its card shows no "Checked" date.

## Filters

Each source keeps only what you ask: mentions any of some words, leave out titles with some words, places, remote only, newer than N days. They apply before anything is stored.

## Politeness and safety

- Only public `https` addresses; private networks, credentials in addresses and redirects to private addresses are refused.
- Pages (not APIs) are read only if the site's `robots.txt` allows it, with a pause between pages. A site whose `robots.txt` cannot be read is not read.
- A size cap and a 20-second limit per request; one retry if the connection drops.
- A failing source waits twice as long after each failure in a row (at most a day) instead of being retried every pass. Changing its settings, or switching it back on, clears the wait.
- The schedule runs inside the API (`SOURCES_POLL_MS`, default 60000; 0 turns it off). Several API servers can run together: a source is claimed for ten minutes while it is read.
- Every read leaves a line in the source's **History** (when, by hand or automatic, found/new/known/filtered, result), and an audit entry.

## Adding a kind of source

1. Write a connector (`apps/api/src/jobs/connectors/`): `validateConfig(config)` returns a plain-words problem or `null`; `fetch(config, fetcher)` returns raw postings. Use the injected fetcher: it carries the guards.
2. Register it in `connectors/index.ts` and in `SOURCE_TYPES` (`db/schema.ts`, plus a migration for the database check).
3. Add an entry to `catalog.ts` with its fields, and a real example to `scripts/sources-live-check.mjs`. Do not put a "tested" date on it until the live check has read real jobs.
