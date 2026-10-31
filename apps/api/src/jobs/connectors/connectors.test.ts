import { describe, expect, it } from 'vitest';
import { CATALOG, buildConfig } from '../catalog.js';
import type { FetchInit, JobFeedFetcher } from '../feeds.js';
import { applyFilters, sourceFiltersSchema } from '../filters.js';
import { retryAfterMinutes } from '../jobs.service.js';
import { CONNECTORS } from './index.js';
import { Robots, extractJobPostings, importPostingFromUrl, pathGet } from './generic.js';

/** Canned answers by address; anything else answers 404 like a real site would. */
class Pages implements JobFeedFetcher {
  readonly asked: string[] = [];
  readonly pages = new Map<string, string>();
  async fetchText(url: string, _init?: FetchInit): Promise<string> {
    void _init;
    this.asked.push(url);
    const body = this.pages.get(url);
    if (body === undefined) throw new Error(`${new URL(url).hostname} answered 404`);
    return body;
  }
}

const jobLd = (title: string, extra = '') =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title,
    description: '<p>Build things with TypeScript.</p>',
    datePosted: '2026-10-01',
    hiringOrganization: { '@type': 'Organization', name: 'Acme Ltd' },
    jobLocation: {
      '@type': 'Place',
      address: { addressLocality: 'Addis Ababa', addressCountry: 'ET' },
    },
  })}</script></head><body>${extra}</body></html>`;

describe('platform connectors', () => {
  it('reads a Lever account and says what is wrong with a bad name', async () => {
    const f = new Pages();
    f.pages.set(
      'https://api.lever.co/v0/postings/acme?mode=json',
      JSON.stringify([
        {
          id: 'a1',
          text: 'Backend Engineer',
          categories: { location: 'Remote - EMEA' },
          descriptionPlain: 'Node and Postgres',
          hostedUrl: 'https://jobs.lever.co/acme/a1',
          createdAt: 1790000000000,
        },
      ]),
    );
    const out = await CONNECTORS.LEVER.fetch({ site: 'acme' }, f);
    expect(out).toEqual([
      expect.objectContaining({
        externalId: 'a1',
        title: 'Backend Engineer',
        company: 'acme',
        url: 'https://jobs.lever.co/acme/a1',
      }),
    ]);
    expect(out[0]!.location).toMatch(/Remote/);
    expect(CONNECTORS.LEVER.validateConfig({ site: 'a b/c' })).toMatch(/cannot be part/);
    expect(CONNECTORS.LEVER.validateConfig({})).toMatch(/required/);
    await expect(CONNECTORS.LEVER.fetch({ site: 'nope' }, f)).rejects.toThrow(/404/);
  });

  it('reads Remotive, keeping each job’s own address', async () => {
    const f = new Pages();
    f.pages.set(
      'https://remotive.com/api/remote-jobs?limit=200&category=software-dev',
      JSON.stringify({
        jobs: [
          {
            id: 7,
            title: 'Rust Dev',
            company_name: 'Globex',
            candidate_required_location: 'Worldwide',
            description: '<b>Rust</b>',
            url: 'https://remotive.com/remote-jobs/7',
            publication_date: '2026-10-02T10:00:00',
          },
        ],
      }),
    );
    const out = await CONNECTORS.REMOTIVE.fetch({ category: 'software-dev' }, f);
    expect(out[0]).toMatchObject({
      title: 'Rust Dev',
      company: 'Globex',
      url: 'https://remotive.com/remote-jobs/7',
    });
  });
});

describe('pages that publish job data', () => {
  it('finds JobPosting data in a page, in a list and in a graph', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@graph': [
        { '@type': 'WebSite' },
        {
          '@type': 'JobPosting',
          title: 'QA Lead',
          hiringOrganization: { name: 'Initech' },
          identifier: { value: 'q9' },
        },
      ],
    })}</script><script type="application/ld+json">not json</script>`;
    const out = extractJobPostings(html, 'https://initech.test/jobs', 'fallback');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 'q9', title: 'QA Lead', company: 'Initech' });
  });

  it('reads a sitemap newest first, only job pages, and respects robots.txt', async () => {
    const f = new Pages();
    f.pages.set('https://board.test/robots.txt', 'User-agent: *\nDisallow: /jobs/private/');
    f.pages.set(
      'https://board.test/sitemap.xml',
      `<urlset>
        <url><loc>https://board.test/jobs/old</loc><lastmod>2026-01-01</lastmod></url>
        <url><loc>https://board.test/jobs/new</loc><lastmod>2026-10-01</lastmod></url>
        <url><loc>https://board.test/jobs/private/x</loc><lastmod>2026-10-02</lastmod></url>
        <url><loc>https://board.test/about</loc><lastmod>2026-10-03</lastmod></url>
      </urlset>`,
    );
    f.pages.set('https://board.test/jobs/old', jobLd('Old Role'));
    f.pages.set('https://board.test/jobs/new', jobLd('New Role'));
    f.pages.set('https://board.test/jobs/private/x', jobLd('Secret Role'));
    const out = await CONNECTORS.STRUCTURED_DATA.fetch(
      { url: 'https://board.test/sitemap.xml', pathContains: '/jobs/' },
      f,
    );
    expect(out.map((p) => p.title)).toEqual(['New Role', 'Old Role']);
    expect(f.asked).not.toContain('https://board.test/jobs/private/x');
    expect(f.asked).not.toContain('https://board.test/about');
  });

  it('refuses a page robots.txt closes, rather than reading it anyway', async () => {
    const f = new Pages();
    f.pages.set('https://closed.test/robots.txt', 'User-agent: *\nDisallow: /');
    f.pages.set('https://closed.test/jobs', jobLd('Hidden'));
    await expect(
      CONNECTORS.STRUCTURED_DATA.fetch({ url: 'https://closed.test/jobs' }, f),
    ).rejects.toThrow(/robots\.txt/);
    expect(f.asked).not.toContain('https://closed.test/jobs');
  });

  it('robots.txt: the longest rule wins and allow wins a tie; a failing server is not read', async () => {
    const f = new Pages();
    f.pages.set(
      'https://r.test/robots.txt',
      'User-agent: *\nDisallow: /a\nAllow: /a/open\n\nUser-agent: jobpilot\nDisallow: /private',
    );
    const robots = new Robots(f);
    expect(await robots.allowed('https://r.test/private/x')).toBe(false);
    expect(await robots.allowed('https://r.test/a/closed')).toBe(true); // the named group replaces the * group
    const g = new Pages();
    g.pages.set('https://g.test/robots.txt', 'User-agent: *\nDisallow: /a\nAllow: /a/open');
    const generic = new Robots(g, 'someone-else');
    expect(await generic.allowed('https://g.test/a/closed')).toBe(false);
    expect(await generic.allowed('https://g.test/a/open/1')).toBe(true);
    const broken: JobFeedFetcher = {
      fetchText: async () => Promise.reject(new Error('x.test answered 503')),
    };
    expect(await new Robots(broken).allowed('https://x.test/jobs')).toBe(false);
  });

  it('adds one job from its own link, and says so when the page is not a job', async () => {
    const f = new Pages();
    f.pages.set('https://acme.test/careers/1', jobLd('Platform Engineer'));
    f.pages.set('https://acme.test/blog', '<html><head><title></title></head></html>');
    f.pages.set(
      'https://acme.test/careers/2',
      '<html><head><meta property="og:title" content="Data Analyst | Acme"><meta property="og:site_name" content="Acme"></head><body></body></html>',
    );
    expect(await importPostingFromUrl('https://acme.test/careers/1', f)).toMatchObject({
      title: 'Platform Engineer',
      company: 'Acme Ltd',
    });
    expect(await importPostingFromUrl('https://acme.test/careers/2', f)).toMatchObject({
      title: 'Data Analyst',
      company: 'Acme',
    });
    await expect(importPostingFromUrl('https://acme.test/blog', f)).rejects.toThrow(
      /does not look like a job/,
    );
  });
});

describe('configured JSON and HTML sources', () => {
  it('reads field paths, including arrays and a Next.js page’s embedded data', async () => {
    expect(pathGet({ a: { b: [{ c: 5 }] } }, 'a.b[0].c')).toBe(5);
    expect(pathGet({ a: null }, 'a.b')).toBeUndefined();
    expect(pathGet({ a: 1 }, undefined)).toEqual({ a: 1 });
    const f = new Pages();
    const data = {
      props: {
        pageProps: {
          jobs: {
            data: [
              {
                slug: 'dev-1',
                title: 'Developer',
                company: { name: 'Bank X' },
                state: 'Addis Ababa',
                description: 'Code',
                date_published: '2026-10-05',
              },
            ],
          },
        },
      },
    };
    f.pages.set('https://listing.test/robots.txt', '');
    f.pages.set(
      'https://listing.test/jobs?page=1',
      `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`,
    );
    f.pages.set(
      'https://listing.test/jobs?page=2',
      `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { jobs: { data: [] } } } })}</script></html>`,
    );
    const config = {
      url: 'https://listing.test/jobs',
      format: 'next-data',
      pageParam: 'page',
      pages: '3',
      itemsPath: 'props.pageProps.jobs.data',
      idPath: 'slug',
      titlePath: 'title',
      companyPath: 'company.name',
      locationPath: 'state',
      descriptionPath: 'description',
      datePath: 'date_published',
      urlTemplate: 'https://listing.test/jobs/{id}',
    };
    expect(CONNECTORS.JSON_API.validateConfig(config)).toBeNull();
    const out = await CONNECTORS.JSON_API.fetch(config, f);
    expect(out).toEqual([
      expect.objectContaining({
        externalId: 'dev-1',
        title: 'Developer',
        company: 'Bank X',
        location: 'Addis Ababa',
        url: 'https://listing.test/jobs/dev-1',
      }),
    ]);
    expect(f.asked).toContain('https://listing.test/jobs?page=2'); // an empty page ends the read
    expect(f.asked).not.toContain('https://listing.test/jobs?page=3');
  });

  it('asks for what a JSON source is missing, in plain words', () => {
    expect(CONNECTORS.JSON_API.validateConfig({ url: 'http://x.test/a' })).toMatch(/https/);
    expect(CONNECTORS.JSON_API.validateConfig({ url: 'https://x.test/a' })).toMatch(/titlePath/);
    expect(CONNECTORS.JSON_API.validateConfig({ url: 'https://x.test/a', titlePath: 't' })).toMatch(
      /companyName/,
    );
    expect(
      CONNECTORS.JSON_API.validateConfig({
        url: 'https://x.test/a',
        titlePath: 't',
        companyName: 'X',
      }),
    ).toMatch(/urlPath/);
  });

  it('reads a listing page with CSS selectors and resolves relative links', async () => {
    const f = new Pages();
    f.pages.set('https://list.test/robots.txt', '');
    f.pages.set(
      'https://list.test/jobs',
      `<ul><li class="job"><h3><a href="/jobs/9">Accountant</a></h3><span class="co">Bank Y</span><span class="where">Hawassa</span><time datetime="2026-10-07">x</time></li>
        <li class="job"><h3></h3></li></ul>`,
    );
    const config = {
      url: 'https://list.test/jobs',
      itemSelector: '.job',
      titleSelector: 'h3 a',
      companySelector: '.co',
      locationSelector: '.where',
      dateSelector: 'time',
    };
    expect(CONNECTORS.HTML_LIST.validateConfig(config)).toBeNull();
    const out = await CONNECTORS.HTML_LIST.fetch(config, f);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      title: 'Accountant',
      company: 'Bank Y',
      location: 'Hawassa',
      url: 'https://list.test/jobs/9',
    });
    expect(out[0]!.postedAt?.toISOString().slice(0, 10)).toBe('2026-10-07');
    await expect(CONNECTORS.HTML_LIST.fetch({ ...config, itemSelector: '[[' }, f)).rejects.toThrow(
      /not a valid CSS selector/,
    );
  });
});

describe('source filters', () => {
  const posting = (
    title: string,
    location: string | null,
    description = '',
    postedAt: Date | null = null,
  ) => ({ externalId: title, title, company: 'Acme', location, description, url: null, postedAt });
  const parse = (v: unknown) => sourceFiltersSchema.parse(v);

  it('keeps everything when nothing is set', () => {
    expect(applyFilters([posting('A', null)], parse({})).kept).toHaveLength(1);
  });

  it('include, exclude, place, remote and age each narrow the list', () => {
    const now = new Date('2026-10-30T00:00:00Z');
    const all = [
      posting(
        'Senior TypeScript Engineer',
        'Remote',
        'We work from anywhere',
        new Date('2026-10-28'),
      ),
      posting('Junior Java Developer', 'Nairobi', '', new Date('2026-10-28')),
      posting('TypeScript Intern', 'Addis Ababa', '', new Date('2026-05-01')),
    ];
    const run = (f: unknown) => applyFilters(all, parse(f), now).kept.map((p) => p.title);
    expect(run({ include: ['typescript'] })).toEqual([
      'Senior TypeScript Engineer',
      'TypeScript Intern',
    ]);
    expect(run({ include: ['typescript'], exclude: ['intern'] })).toEqual([
      'Senior TypeScript Engineer',
    ]);
    expect(run({ locations: ['addis'] })).toEqual(['TypeScript Intern']);
    expect(run({ remoteOnly: true })).toEqual(['Senior TypeScript Engineer']);
    expect(run({ maxAgeDays: 30 })).toEqual([
      'Senior TypeScript Engineer',
      'Junior Java Developer',
    ]);
    expect(applyFilters(all, parse({ exclude: ['java'] }), now).dropped).toBe(1);
  });

  it('refuses a filter it does not know, so a typo is not silently ignored', () => {
    expect(sourceFiltersSchema.safeParse({ includes: ['x'] }).success).toBe(false);
  });
});

describe('the catalog', () => {
  it('has unique ids, every entry honest about how it works, and a usable form', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of CATALOG) {
      if (e.access === 'LINK_ONLY') {
        expect(e.type, e.id).toBeNull();
        expect(e.note, e.id).toBeTruthy();
      } else {
        expect(e.type, e.id).not.toBeNull();
      }
      const keys = e.fields.map((f) => f.key);
      expect(new Set(keys).size, e.id).toBe(keys.length);
    }
  });

  it('every readable entry builds settings its connector accepts when filled with example values', () => {
    const example = (kind: string, key: string): string =>
      kind === 'url'
        ? 'https://example.test/jobs'
        : kind === 'number'
          ? '2'
          : key === 'host'
            ? 'acme.wd3.myworkdayjobs.com'
            : key === 'titlePath'
              ? 'title'
              : key === 'itemSelector'
                ? '.job'
                : key === 'titleSelector'
                  ? 'a'
                  : 'acme';
    for (const e of CATALOG.filter((x) => x.type)) {
      const values: Record<string, string> = {};
      for (const f of e.fields) {
        if (
          !f.required &&
          !(
            e.access === 'CONFIGURE' &&
            ['companyName', 'urlTemplate', 'companySelector'].includes(f.key)
          )
        )
          continue;
        values[f.key] =
          f.kind === 'select'
            ? f.options![0]!.value || f.options![1]!.value
            : example(f.kind, f.key);
      }
      if (e.id === 'json')
        Object.assign(values, {
          titlePath: 'title',
          companyName: 'Acme',
          urlTemplate: 'https://example.test/{id}',
        });
      if (e.id === 'html')
        Object.assign(values, { itemSelector: '.job', titleSelector: 'a', companyName: 'Acme' });
      const built = buildConfig(e, values);
      expect('problem' in built ? built.problem : null, e.id).toBeNull();
    }
  });

  it('turns what a person typed into settings: templates filled and encoded, placeholders not stored', () => {
    const teamtailor = CATALOG.find((e) => e.id === 'teamtailor')!;
    expect(buildConfig(teamtailor, { slug: 'acme' })).toEqual({
      config: { feedUrl: 'https://acme.teamtailor.com/jobs.rss' },
    });
    const wwr = CATALOG.find((e) => e.id === 'wwr')!;
    expect(buildConfig(wwr, { category: 'categories/remote-design-jobs.rss' })).toEqual({
      config: {
        feedUrl: 'https://weworkremotely.com/categories/remote-design-jobs.rss',
        companyName: 'We Work Remotely',
      },
    });
  });

  it('says what is missing or wrong in words, and never builds a link-only entry', () => {
    const lever = CATALOG.find((e) => e.id === 'lever')!;
    expect(buildConfig(lever, {})).toEqual({ problem: 'Account name is required' });
    expect(buildConfig(lever, { site: 'a b' })).toEqual({
      problem: expect.stringMatching(/cannot be part/),
    });
    expect(buildConfig(lever, { site: 'acme', region: 'mars' })).toEqual({
      problem: 'Data region is not one of the choices',
    });
    const linkedin = CATALOG.find((e) => e.id === 'linkedin')!;
    expect(buildConfig(linkedin, {})).toEqual({
      problem: expect.stringMatching(/cannot be read automatically/),
    });
  });

  it('names every site the owner asked for', () => {
    const names = CATALOG.map((e) => e.name.toLowerCase()).join('|');
    for (const want of [
      'linkedin',
      'glassdoor',
      'google careers',
      'ethiojobs',
      'hahu',
      'bayt',
      'indeed',
    ])
      expect(names).toContain(want);
    expect(CATALOG.some((e) => /jobs in africa|careers24|jobberman/i.test(e.summary))).toBe(true);
    expect(CATALOG.some((e) => /bank/i.test(`${e.summary} ${e.tags.join(' ')}`))).toBe(true);
  });
});

describe('back-off', () => {
  it('doubles the wait for each failure in a row, up to a day', () => {
    expect(retryAfterMinutes(60, 1)).toBe(120);
    expect(retryAfterMinutes(60, 3)).toBe(480);
    expect(retryAfterMinutes(60, 10)).toBe(1440);
    expect(retryAfterMinutes(5, 0)).toBe(5);
  });
});
