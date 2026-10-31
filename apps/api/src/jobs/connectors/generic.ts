import { parse as parseHtml } from 'node-html-parser';
import type { JobFeedFetcher } from '../feeds.js';
import { toPlainText, type RawPosting } from '../normalize.js';
import {
  asArray,
  dateOf,
  MAX_POSTINGS,
  mapLimit,
  placeOf,
  text,
  xml,
  type JobSourceConnector,
  type Loose,
} from './util.js';

/**
 * Connectors for platforms that have no ready-made interface here: anything that publishes structured
 * job data (schema.org JobPosting), a JSON API, or a plain listing page. They are configured, not coded.
 * Pages are read politely: robots.txt is obeyed and requests are spaced out.
 */

// ---------------------------------------------------------------- robots.txt

interface Rule {
  allow: boolean;
  pattern: RegExp;
  length: number;
}

function rulesFrom(body: string, agent: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let sawRule = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === 'user-agent') {
      if (!current || sawRule) {
        current = { agents: [], rules: [] };
        groups.push(current);
        sawRule = false;
      }
      current.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && current) {
      sawRule = true;
      if (value === '') continue;
      const source = value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      current.rules.push({
        allow: key === 'allow',
        pattern: new RegExp(`^${source}`),
        length: value.length,
      });
    }
  }
  const mine =
    groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a))) ??
    groups.find((g) => g.agents.includes('*'));
  return mine?.rules ?? [];
}

/** Asks a site's robots.txt whether a page may be read: the longest matching rule wins, and allowing wins a tie. */
export class Robots {
  private readonly cache = new Map<string, Rule[] | 'deny'>();
  constructor(
    private readonly fetcher: JobFeedFetcher,
    private readonly agent = 'jobpilot',
  ) {}

  async allowed(raw: string): Promise<boolean> {
    const url = new URL(raw);
    let rules = this.cache.get(url.origin);
    if (rules === undefined) {
      try {
        rules = rulesFrom(await this.fetcher.fetchText(`${url.origin}/robots.txt`), this.agent);
      } catch (error) {
        // No robots.txt (a 404) means everything is allowed; a server that is failing is not asked again.
        rules = /answered 4\d\d/.test((error as Error).message) ? [] : 'deny';
      }
      this.cache.set(url.origin, rules);
    }
    if (rules === 'deny') return false;
    const path = url.pathname + url.search;
    let best: Rule | null = null;
    for (const r of rules) {
      if (
        r.pattern.test(path) &&
        (!best || r.length > best.length || (r.length === best.length && r.allow))
      )
        best = r;
    }
    return best ? best.allow : true;
  }

  async must(raw: string): Promise<void> {
    if (!(await this.allowed(raw)))
      throw new Error(
        `${new URL(raw).hostname} asks not to be read at ${new URL(raw).pathname} (robots.txt)`,
      );
  }
}

const pause = (ms: number) =>
  new Promise((r) => setTimeout(r, process.env['NODE_ENV'] === 'test' ? 0 : ms));

// ---------------------------------------------------------------- schema.org JobPosting

function* postingsIn(node: unknown): Generator<Loose> {
  if (Array.isArray(node)) {
    for (const n of node) yield* postingsIn(n);
  } else if (node && typeof node === 'object') {
    const o = node as Loose;
    const types = asArray<string>(o['@type']).map(String);
    if (types.includes('JobPosting')) yield o;
    if (o['@graph']) yield* postingsIn(o['@graph']);
    if (o['itemListElement']) yield* postingsIn(o['itemListElement']);
    if (o['item']) yield* postingsIn(o['item']);
  }
}

function placeFrom(j: Loose): string | null {
  const locations = asArray<Loose>(j['jobLocation']).map((l) => {
    const a = (l['address'] ?? l) as Loose;
    return [
      text(a['addressLocality']),
      text(a['addressRegion']),
      text(a['addressCountry']?.name ?? a['addressCountry']),
    ]
      .filter(Boolean)
      .join(', ');
  });
  const remote =
    text(j['jobLocationType']).toUpperCase() === 'TELECOMMUTE' || /remote/i.test(text(j['title']));
  return placeOf([locations.filter(Boolean).join(' / ')], remote);
}

export function postingFromJsonLd(
  j: Loose,
  pageUrl: string,
  companyFallback: string,
): RawPosting | null {
  const title = text(j['title']).trim();
  if (!title) return null;
  const salary = j['baseSalary']?.value;
  const salaryLine =
    salary && (salary['minValue'] || salary['maxValue'])
      ? `Salary: ${salary['minValue'] ?? ''} - ${salary['maxValue'] ?? ''} ${text(j['baseSalary']?.currency)}`
      : '';
  const url = text(j['url']) || pageUrl;
  return {
    externalId: text(j['identifier']?.value ?? j['identifier']) || url,
    title,
    company:
      text(j['hiringOrganization']?.name ?? j['hiringOrganization']).trim() || companyFallback,
    location: placeFrom(j),
    description: [text(j['description']), text(j['employmentType']), salaryLine]
      .filter(Boolean)
      .join('\n\n'),
    url,
    postedAt: dateOf(j['datePosted']),
  };
}

/** Every JobPosting a page declares for search engines, whether it is one job or a listing of several. */
export function extractJobPostings(
  html: string,
  pageUrl: string,
  companyFallback: string,
): RawPosting[] {
  const root = parseHtml(html);
  const out: RawPosting[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      for (const j of postingsIn(JSON.parse(script.text))) {
        const p = postingFromJsonLd(j, pageUrl, companyFallback);
        if (p) out.push(p);
      }
    } catch {
      // a malformed block is skipped; the page's other blocks may still be fine
    }
  }
  return out;
}

/**
 * One job from its link, for a person who found it anywhere (a LinkedIn alert, a bookmark, a friend):
 * structured data first, then the page's own title and description.
 */
export async function importPostingFromUrl(
  url: string,
  fetcher: JobFeedFetcher,
): Promise<RawPosting> {
  const html = await fetcher.fetchText(url, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
  const host = new URL(url).hostname.replace(/^www\./, '');
  const found = extractJobPostings(html, url, host);
  if (found[0]) return { ...found[0], url: found[0].url ?? url };
  const root = parseHtml(html);
  const meta = (name: string) =>
    root.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ??
    root.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ??
    '';
  const title = (meta('og:title') || root.querySelector('title')?.text || '').trim();
  if (!title)
    throw new Error(
      'This page does not look like a job posting (no title or structured data was found)',
    );
  return {
    externalId: url,
    title: title.replace(/\s+[|\-–]\s+.*$/, '').trim() || title,
    company: (meta('og:site_name') || host).trim(),
    location: null,
    description: toPlainText(
      meta('og:description') ||
        meta('description') ||
        root.querySelector('body')?.text.slice(0, 6000) ||
        '',
    ),
    url,
    postedAt: null,
  };
}

const httpsUrl = (v: string | undefined) => !!v && /^https:\/\/[^\s]+$/i.test(v);
const limitOf = (c: Record<string, string>, key: string, dflt: number, max: number) =>
  Math.max(1, Math.min(Number(c[key]) || dflt, max));

// ---------------------------------------------------------------- structured data on pages or in a sitemap

async function sitemapUrls(
  url: string,
  fetcher: JobFeedFetcher,
  robots: Robots,
  depth = 0,
): Promise<{ loc: string; lastmod: number }[]> {
  await robots.must(url);
  const doc = xml.parse(await fetcher.fetchText(url, { maxBytes: 20 * 1024 * 1024 })) as Loose;
  if (doc['sitemapindex'] && depth < 2) {
    const out: { loc: string; lastmod: number }[] = [];
    for (const s of asArray<Loose>(doc['sitemapindex'].sitemap).slice(0, 8)) {
      try {
        out.push(...(await sitemapUrls(text(s['loc']), fetcher, robots, depth + 1)));
      } catch {
        // one unreadable part of a large sitemap does not stop the others
      }
    }
    return out;
  }
  return asArray<Loose>(doc['urlset']?.url).map((u) => ({
    loc: text(u['loc']),
    lastmod: Date.parse(text(u['lastmod'])) || 0,
  }));
}

export const structuredDataConnector: JobSourceConnector = {
  validateConfig(c) {
    if (!httpsUrl(c['url']))
      return 'url must be an https address: a job page, a listing page or a sitemap';
    return null;
  },
  async fetch(c, f) {
    const robots = new Robots(f);
    const host = new URL(c['url']!).hostname.replace(/^www\./, '');
    const company = c['companyName']?.trim() || host;
    const isSitemap =
      c['mode'] === 'sitemap' || (c['mode'] !== 'page' && /\.xml(\.gz)?(\?|$)/i.test(c['url']!));
    if (!isSitemap) {
      await robots.must(c['url']!);
      return extractJobPostings(await f.fetchText(c['url']!), c['url']!, company).slice(
        0,
        MAX_POSTINGS,
      );
    }
    const contains = c['pathContains']?.trim();
    const urls = (await sitemapUrls(c['url']!, f, robots))
      .filter((u) => u.loc.startsWith('https://') && (!contains || u.loc.includes(contains)))
      .sort((a, b) => b.lastmod - a.lastmod)
      .slice(0, limitOf(c, 'maxPages', 25, 60));
    const pages = await mapLimit(urls, 2, async (u) => {
      try {
        if (!(await robots.allowed(u.loc))) return [];
        await pause(400);
        return extractJobPostings(await f.fetchText(u.loc), u.loc, company);
      } catch {
        return [];
      }
    });
    return pages.flat().slice(0, MAX_POSTINGS);
  },
};

// ---------------------------------------------------------------- any JSON API, mapped by field paths

/** "data.items[0].name" read from parsed JSON. */
export function pathGet(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return undefined;
    if (m[1]) cur = (cur as Loose)[m[1]];
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g))
      cur = (cur as unknown[] | undefined)?.[Number(idx[1])];
  }
  return cur;
}

export const jsonApiConnector: JobSourceConnector = {
  validateConfig(c) {
    if (!httpsUrl(c['url'])) return 'url must be the https address of the JSON API';
    if (!c['titlePath'])
      return 'titlePath is required: where the job title is inside each item (for example "title")';
    if (!c['companyPath'] && !c['companyName'])
      return 'give companyName, or companyPath to read it from each item';
    if (!c['urlPath'] && !c['urlTemplate'])
      return 'give urlPath, or urlTemplate with {id} to build each job link';
    return null;
  },
  async fetch(c, f) {
    const robots = new Robots(f);
    const pages = limitOf(c, 'pages', 1, 5);
    const out: RawPosting[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const url = new URL(c['url']!);
      if (c['pageParam']) url.searchParams.set(c['pageParam'], String(page));
      let body: unknown;
      if (c['format'] === 'next-data') {
        // A Next.js site embeds the data its page was built from; the same listing a person sees.
        await robots.must(url.toString());
        if (page > 1) await pause(800);
        const html = await f.fetchText(url.toString(), { headers: { accept: 'text/html' } });
        const embedded = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
        if (!embedded)
          throw new Error(
            'This page has no embedded Next.js data (format "next-data" needs a Next.js site)',
          );
        body = JSON.parse(embedded[1]!);
      } else {
        body = JSON.parse(
          await f.fetchText(url.toString(), { headers: { accept: 'application/json' } }),
        );
      }
      const items = asArray(pathGet(body, c['itemsPath'])) as Loose[];
      for (const item of items) {
        const id = text(pathGet(item, c['idPath']));
        const title = text(pathGet(item, c['titlePath'])).trim();
        if (!title) continue;
        out.push({
          externalId: id || null,
          title,
          company: c['companyPath']
            ? text(pathGet(item, c['companyPath'])).trim() || c['companyName'] || 'Unknown'
            : c['companyName']!,
          location: placeOf([text(pathGet(item, c['locationPath']))]),
          description: text(pathGet(item, c['descriptionPath'])),
          url: c['urlPath']
            ? text(pathGet(item, c['urlPath'])) || null
            : c['urlTemplate']!.replace('{id}', encodeURIComponent(id)),
          postedAt: dateOf(pathGet(item, c['datePath'])),
        });
      }
      if (items.length === 0 || !c['pageParam']) break;
    }
    return out.slice(0, MAX_POSTINGS);
  },
};

// ---------------------------------------------------------------- any listing page, read with CSS selectors

export const htmlListConnector: JobSourceConnector = {
  validateConfig(c) {
    if (!httpsUrl(c['url'])) return 'url must be the https address of the listing page';
    if (!c['itemSelector'])
      return 'itemSelector is required: the CSS selector that matches each job on the page (for example ".job-card")';
    if (!c['titleSelector'])
      return 'titleSelector is required: where the title is inside each job (for example "h3 a")';
    if (!c['companySelector'] && !c['companyName'])
      return 'give companyName, or companySelector to read it from each job';
    return null;
  },
  async fetch(c, f) {
    const robots = new Robots(f);
    const pages = limitOf(c, 'pages', 1, 5);
    const out: RawPosting[] = [];
    for (let page = 1; page <= pages; page += 1) {
      const url = new URL(c['url']!);
      if (c['pageParam']) url.searchParams.set(c['pageParam'], String(page));
      await robots.must(url.toString());
      if (page > 1) await pause(800);
      const root = parseHtml(
        await f.fetchText(url.toString(), { headers: { accept: 'text/html' } }),
      );
      let items;
      try {
        items = root.querySelectorAll(c['itemSelector']!);
      } catch {
        throw new Error(`itemSelector "${c['itemSelector']}" is not a valid CSS selector`);
      }
      for (const el of items) {
        const titleEl = el.querySelector(c['titleSelector']!);
        const title = titleEl?.text.trim();
        if (!title) continue;
        const linkEl = c['linkSelector'] ? el.querySelector(c['linkSelector']) : titleEl;
        const href =
          linkEl?.getAttribute('href') ??
          titleEl?.closest('a')?.getAttribute('href') ??
          el.querySelector('a')?.getAttribute('href');
        const link = href ? new URL(href, url).toString() : null;
        out.push({
          externalId: link,
          title,
          company:
            (c['companySelector'] ? el.querySelector(c['companySelector'])?.text.trim() : '') ||
            c['companyName'] ||
            'Unknown',
          location: placeOf([
            c['locationSelector'] ? el.querySelector(c['locationSelector'])?.text.trim() : '',
          ]),
          description: c['descriptionSelector']
            ? (el.querySelector(c['descriptionSelector'])?.text.trim() ?? '')
            : '',
          url: link,
          postedAt: c['dateSelector']
            ? dateOf(
                el.querySelector(c['dateSelector'])?.getAttribute('datetime') ??
                  el.querySelector(c['dateSelector'])?.text.trim(),
              )
            : null,
        });
      }
      if (items.length === 0) break;
    }
    return out.slice(0, MAX_POSTINGS);
  },
};
