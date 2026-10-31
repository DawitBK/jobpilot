import { XMLParser } from 'fast-xml-parser';
import type { FetchInit, JobFeedFetcher } from '../feeds.js';
import type { RawPosting } from '../normalize.js';

/** What a connector is: it checks its own settings without the network, then reads one source. */
export interface JobSourceConnector {
  validateConfig(config: Record<string, string>): string | null;
  fetch(config: Record<string, string>, fetcher: JobFeedFetcher): Promise<RawPosting[]>;
}

/** No source returns more than this many postings in one read: a runaway feed cannot flood a workspace. */
export const MAX_POSTINGS = 500;

export const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  trimValues: true,
});

// Parsed XML and third-party JSON have no fixed shape, so they are read defensively through this loose type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = Record<string, any>;

export const asArray = <T>(v: T | T[] | undefined | null): T[] =>
  v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

/** Any scalar or { '#text' } node as a string; objects are flattened to their scalar values. */
export function text(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(text).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return String(o['#text']);
    return Object.values(o).map(text).filter(Boolean).join(', ');
  }
  return '';
}

export function dateOf(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v));
  const d = new Date(n);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Settings that name an account on a platform: letters, digits, dots, dashes, underscores. */
export const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export const requireSlug = (
  config: Record<string, string>,
  key: string,
  what: string,
): string | null => {
  const v = config[key];
  if (!v) return `${key} is required: ${what}`;
  return SLUG.test(v) ? null : `${key} has characters that cannot be part of a ${what}`;
};

export async function getJson<T = Loose>(
  fetcher: JobFeedFetcher,
  url: string,
  init?: FetchInit,
): Promise<T> {
  const body = await fetcher.fetchText(url, { headers: { accept: 'application/json' }, ...init });
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(
      `${new URL(url).hostname} did not answer with JSON (is the account name right?)`,
    );
  }
}

/** Run `work` over `items` with at most `n` at a time, keeping the order. */
export async function mapLimit<T, R>(
  items: T[],
  n: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]!);
      }
    }),
  );
  return out;
}

/** A readable location line from the pieces a platform gives, and a "(Remote)" marker the normalizer understands. */
export function placeOf(
  parts: (string | null | undefined)[],
  remote?: boolean | null,
): string | null {
  const line = parts.filter((p): p is string => Boolean(p && p.trim())).join(', ');
  const tagged = remote ? `${line ? `${line} ` : ''}(Remote)` : line;
  return tagged || null;
}

export const defaultCompany = (config: Record<string, string>, fallback: string) =>
  config['companyName']?.trim() || fallback;
