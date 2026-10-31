import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { XMLParser } from 'fast-xml-parser';
import { ProblemException } from '@jobpilot/kit';
import type { RawPosting } from './normalize.js';

export const JOB_FEED_FETCHER = 'JOB_FEED_FETCHER';

/** The only thing the connectors need from the network. Tests replace it with canned feeds. */
export interface FetchInit {
  method?: 'GET' | 'POST';
  body?: string;
  headers?: Record<string, string>;
  /** Larger than the default for the few feeds that are big (up to 40 MB). */
  maxBytes?: number;
}

export interface JobFeedFetcher {
  fetchText(url: string, init?: FetchInit): Promise<string>;
}

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_BYTES_CEILING = 40 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** Who we are to the sites we read: honest, and with a way to reach the operator. */
export const USER_AGENT = 'JobPilot/1.0 (job search tool; reads public job postings)';

/** True for any address that must never be reached from a user-supplied URL (SSRF). */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(':')) {
    const a = address.toLowerCase();
    return (
      a === '::1' ||
      a === '::' ||
      a.startsWith('fc') ||
      a.startsWith('fd') ||
      a.startsWith('fe80') ||
      a.startsWith('::ffff:127.') ||
      a.startsWith('::ffff:10.') ||
      a.startsWith('::ffff:192.168.') ||
      /^::ffff:172\.(1[6-9]|2\d|3[01])\./.test(a)
    );
  }
  const [a, b] = address.split('.').map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** Refuse anything but a public https URL: no credentials, no IP literals in private ranges, no internal names. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProblemException(422, 'invalid-url', 'Not a valid URL', raw);
  }
  if (url.protocol !== 'https:') {
    throw new ProblemException(422, 'url-not-https', 'Only https feeds are allowed', url.protocol);
  }
  if (url.username || url.password) {
    throw new ProblemException(422, 'url-has-credentials', 'The URL must not carry credentials');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((r) => r.address);
  if (addresses.length === 0) {
    throw new ProblemException(422, 'host-unresolvable', 'The host does not resolve', host);
  }
  if (addresses.some(isPrivateAddress)) {
    throw new ProblemException(
      422,
      'host-not-public',
      'The host is not a public address',
      'Feeds on private networks cannot be read',
    );
  }
  return url;
}

/** The connection failed (as opposed to the site answering with an error): worth trying once more. */
class NetworkError extends Error {}

const reason = (e: unknown): string => {
  const cause = (e as { cause?: { code?: string; message?: string } }).cause;
  if (cause?.code === 'ENOTFOUND') return 'that address does not exist';
  if ((e as Error).name === 'TimeoutError') return 'it took too long to answer';
  return cause?.code ?? cause?.message ?? (e as Error).message;
};

/** Real network access, with the guards: public https only, a size cap, a timeout, redirects re-checked, one retry if the connection drops. */
export class HttpJobFeedFetcher implements JobFeedFetcher {
  async fetchText(raw: string, init: FetchInit = {}): Promise<string> {
    try {
      return await this.once(raw, init);
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      await new Promise((r) => setTimeout(r, 700));
      try {
        return await this.once(raw, init);
      } catch (again) {
        if (again instanceof NetworkError) throw new Error(again.message, { cause: again });
        throw again;
      }
    }
  }

  private async once(raw: string, init: FetchInit): Promise<string> {
    let url = await assertPublicHttpsUrl(raw);
    const limit = Math.min(init.maxBytes ?? MAX_BYTES, MAX_BYTES_CEILING);
    for (let hop = 0; hop < 4; hop += 1) {
      let res: Response;
      try {
        res = await fetch(url, {
          method: init.method ?? 'GET',
          body: init.body,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
          headers: {
            accept:
              'application/rss+xml, application/atom+xml, application/json, application/xml, text/xml, text/html;q=0.8, */*;q=0.5',
            'user-agent': USER_AGENT,
            ...(init.body ? { 'content-type': 'application/json' } : {}),
            ...init.headers,
          },
        });
      } catch (e) {
        throw new NetworkError(`${url.hostname} could not be reached: ${reason(e)}`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = await assertPublicHttpsUrl(new URL(res.headers.get('location')!, url).toString());
        continue;
      }
      if (!res.ok) throw new Error(`${url.hostname} answered ${res.status}`);
      const length = Number(res.headers.get('content-length') ?? 0);
      if (length > limit) throw new Error('The response is too large');
      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        throw new NetworkError(`${url.hostname} dropped the connection: ${reason(e)}`);
      }
      if (text.length > limit) throw new Error('The response is too large');
      return text;
    }
    throw new Error('Too many redirects');
  }
}

// ---------------------------------------------------------------- connectors

export type { JobSourceConnector } from './connectors/util.js';
import type { JobSourceConnector } from './connectors/util.js';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
});

const text = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v)
    return String((v as { '#text': unknown })['#text']);
  return '';
};
const asArray = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
const dateOf = (s: string): Date | null => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};

// Parsed XML has no fixed shape, so it is read defensively through this loose type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

/** Parse RSS 2.0 or Atom into postings. Titles of the form "Role at Company" are split. */
export function parseFeed(body: string, defaultCompany: string): RawPosting[] {
  const doc = xml.parse(body) as Loose;
  const items: Loose[] = doc['rss']
    ? asArray(doc['rss']?.channel?.item)
    : asArray(doc['feed']?.entry);
  return items.slice(0, 500).map((item) => {
    const link =
      typeof item.link === 'string'
        ? item.link
        : text(asArray(item.link)[0]?.['@_href'] ?? asArray(item.link)[0]);
    const rawTitle = text(item.title).trim();
    const at = rawTitle.match(/^(.*\S)\s+(?:at|@)\s+(\S.*)$/i);
    return {
      externalId: text(item.guid ?? item.id) || link || null,
      title: at ? at[1]! : rawTitle,
      company: text(item['company'] ?? item['author']?.name) || (at ? at[2]! : defaultCompany),
      location: text(item['location'] ?? item['job_location']) || null,
      description: text(
        item.description ?? item['content:encoded'] ?? item.summary ?? item.content,
      ),
      url: link || null,
      postedAt: dateOf(text(item.pubDate ?? item.published ?? item.updated)),
    };
  });
}

export const rssConnector: JobSourceConnector = {
  validateConfig(config) {
    if (!config['feedUrl']) return 'feedUrl is required';
    if (!/^https:\/\//i.test(config['feedUrl'])) return 'feedUrl must be an https URL';
    return null;
  },
  async fetch(config, fetcher) {
    // Most feeds are small; a few (Google's) are tens of megabytes, which the source can allow with maxMb.
    const maxBytes = Math.min(Number(config['maxMb']) || 5, 40) * 1024 * 1024;
    const body = await fetcher.fetchText(config['feedUrl']!, { maxBytes });
    return parseFeed(body, config['companyName'] ?? new URL(config['feedUrl']!).hostname);
  },
};

interface GreenhouseJob {
  id: number | string;
  title: string;
  absolute_url?: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
}

export const greenhouseConnector: JobSourceConnector = {
  validateConfig(config) {
    if (!config['boardToken']) return 'boardToken is required';
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(config['boardToken']))
      return 'boardToken has invalid characters';
    return null;
  },
  async fetch(config, fetcher) {
    // Greenhouse publishes boards through an intentionally public API.
    const url = `https://boards-api.greenhouse.io/v1/boards/${config['boardToken']}/jobs?content=true`;
    const body = JSON.parse(await fetcher.fetchText(url)) as { jobs?: GreenhouseJob[] };
    return (body.jobs ?? []).slice(0, 500).map((j) => ({
      externalId: String(j.id),
      title: j.title,
      company: config['companyName'] ?? config['boardToken']!,
      location: j.location?.name ?? null,
      description: j.content ?? '',
      url: j.absolute_url ?? null,
      postedAt: j.updated_at ? dateOf(j.updated_at) : null,
    }));
  },
};
