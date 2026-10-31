import { z } from 'zod';
import { toPlainText, type RawPosting } from './normalize.js';

/**
 * What a source keeps. Applied to each posting before anything is stored, so an organization that wants
 * only senior remote TypeScript jobs from a firehose feed gets only those. Empty means keep everything.
 */
const words = z.array(z.string().trim().min(1).max(60)).max(30).default([]);

export const sourceFiltersSchema = z
  .object({
    /** Keep a posting that mentions ANY of these words in its title, place or description. */
    include: words,
    /** Drop a posting that mentions ANY of these words in its title or place. */
    exclude: words,
    /** Keep a posting in ANY of these places (a city, a country, "Remote"). */
    locations: words,
    remoteOnly: z.boolean().default(false),
    /** Drop postings older than this many days (a posting with no date is kept). */
    maxAgeDays: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type SourceFilters = z.output<typeof sourceFiltersSchema>;

export const NO_FILTERS: SourceFilters = sourceFiltersSchema.parse({});

const REMOTE = /\b(remote|work from home|wfh|telecommut\w*|anywhere)\b/i;
const has = (haystack: string, term: string) => haystack.toLowerCase().includes(term.toLowerCase());

export function keeps(p: RawPosting, f: SourceFilters, now = new Date()): boolean {
  const title = p.title ?? '';
  const place = p.location ?? '';
  const body = toPlainText(p.description ?? '').slice(0, 4000);
  const front = `${title}\n${place}`;
  const all = `${front}\n${body}`;
  if (f.include.length > 0 && !f.include.some((w) => has(all, w))) return false;
  if (f.exclude.some((w) => has(front, w))) return false;
  if (
    f.locations.length > 0 &&
    !f.locations.some((w) => has(`${place}\n${title}\n${body.slice(0, 400)}`, w))
  )
    return false;
  if (f.remoteOnly && !REMOTE.test(`${front}\n${body.slice(0, 800)}`)) return false;
  if (
    f.maxAgeDays &&
    p.postedAt &&
    now.getTime() - p.postedAt.getTime() > f.maxAgeDays * 86_400_000
  )
    return false;
  return true;
}

export function applyFilters(postings: RawPosting[], filters: SourceFilters, now = new Date()) {
  const kept = postings.filter((p) => keeps(p, filters, now));
  return { kept, dropped: postings.length - kept.length };
}
