import { SOURCE_TYPES } from '../db/schema.js';
import { CONNECTORS } from './connectors/index.js';

/**
 * The menu of job sources. Each entry says what it is, what a person has to tell JobPilot to use it (an
 * account name, a keyword, a page address), and how it can be used honestly:
 *
 *   OPEN       an open feed or interface the site publishes for exactly this
 *   CONFIGURE  works when pointed at a site that publishes structured data, a JSON API or a listing page
 *   LINK_ONLY  no open feed, and the site's terms forbid automated collection: jobs can be added one at a
 *              time from their link (or by pasting the text), which is what a person using a browser does
 *
 * `tested` is the date the entry was last proven against the real site, or null when it was not.
 */
export type Access = 'OPEN' | 'CONFIGURE' | 'LINK_ONLY';

export interface CatalogField {
  key: string;
  label: string;
  kind: 'text' | 'url' | 'select' | 'number';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface CatalogEntry {
  id: string;
  name: string;
  group: string;
  summary: string;
  homepage: string | null;
  access: Access;
  type: (typeof SOURCE_TYPES)[number] | null;
  /** Fixed settings; `{field}` is replaced by what the person typed for that field. */
  fixed: Record<string, string>;
  fields: CatalogField[];
  note: string | null;
  tested: string | null;
  tags: string[];
}

const T = '2026-10-30';

const account = (key: string, label: string, help: string, placeholder: string): CatalogField => ({
  key,
  label,
  kind: 'text',
  required: true,
  placeholder,
  help,
});
const text = (
  key: string,
  label: string,
  placeholder?: string,
  help?: string,
  required = false,
): CatalogField => ({ key, label, kind: 'text', required, placeholder, help });
const url = (
  key: string,
  label: string,
  placeholder?: string,
  help?: string,
  required = true,
): CatalogField => ({ key, label, kind: 'url', required, placeholder, help });
const num = (key: string, label: string, help?: string): CatalogField => ({
  key,
  label,
  kind: 'number',
  help,
});
const select = (
  key: string,
  label: string,
  options: [string, string][],
  help?: string,
  required = false,
): CatalogField => ({
  key,
  label,
  kind: 'select',
  required,
  help,
  options: options.map(([value, l]) => ({ value, label: l })),
});
const company = text(
  'companyName',
  'Company name to show',
  'Acme Ltd',
  'Shown on each job. Leave empty to use the account name.',
);

const entry = (
  e: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'name' | 'group' | 'summary' | 'access'>,
): CatalogEntry => ({
  homepage: null,
  type: null,
  fixed: {},
  fields: [],
  note: null,
  tested: null,
  tags: [],
  ...e,
});

const GLOBAL = 'Remote and global job boards';
const AFRICA = 'Africa and Ethiopia';
const HUMAN = 'Humanitarian and development';
const BIG = 'Large employers';
const ATS = 'A company’s own careers site (by platform)';
const NICHE = 'Niche and custom (you configure it)';
const BLOCKED = 'Sites that forbid automated collection';

export const CATALOG: CatalogEntry[] = [
  // ------------------------------------------------------------------ global
  entry({
    id: 'remotive',
    name: 'Remotive',
    group: GLOBAL,
    summary: 'Curated remote jobs: software, design, marketing, support, data and more.',
    homepage: 'https://remotive.com',
    access: 'OPEN',
    type: 'REMOTIVE',
    tested: T,
    tags: ['remote', 'global'],
    fields: [
      select('category', 'Category', [
        ['', 'All'],
        ['software-dev', 'Software development'],
        ['customer-support', 'Customer support'],
        ['design', 'Design'],
        ['marketing', 'Marketing'],
        ['sales', 'Sales'],
        ['product', 'Product'],
        ['data', 'Data'],
        ['devops', 'DevOps and sysadmin'],
        ['finance-legal', 'Finance and legal'],
        ['human-resources', 'Human resources'],
        ['writing', 'Writing'],
        ['all-others', 'Everything else'],
      ]),
      text('search', 'Search words', 'typescript'),
    ],
    note: 'Their terms ask that jobs link back to Remotive: every job here keeps its Remotive address.',
  }),
  entry({
    id: 'remoteok',
    name: 'Remote OK',
    group: GLOBAL,
    summary: 'A large feed of remote jobs, mostly tech, with salaries when given.',
    homepage: 'https://remoteok.com',
    access: 'OPEN',
    type: 'REMOTEOK',
    tested: T,
    tags: ['remote', 'global'],
    note: 'Their terms ask that jobs link back to Remote OK: every job here keeps its Remote OK address.',
  }),
  entry({
    id: 'himalayas',
    name: 'Himalayas',
    group: GLOBAL,
    summary: 'Remote jobs from companies that hire worldwide, with seniority and pay.',
    homepage: 'https://himalayas.app',
    access: 'OPEN',
    type: 'HIMALAYAS',
    tested: T,
    tags: ['remote', 'global'],
  }),
  entry({
    id: 'wwr',
    name: 'We Work Remotely',
    group: GLOBAL,
    summary: 'One of the largest remote job communities, by category.',
    homepage: 'https://weworkremotely.com',
    access: 'OPEN',
    type: 'RSS',
    tested: T,
    tags: ['remote', 'global'],
    fixed: { feedUrl: 'https://weworkremotely.com/{category}', companyName: 'We Work Remotely' },
    fields: [
      select(
        'category',
        'Category',
        [
          ['remote-jobs.rss', 'All categories'],
          ['categories/remote-programming-jobs.rss', 'Programming'],
          ['categories/remote-devops-sysadmin-jobs.rss', 'DevOps and sysadmin'],
          ['categories/remote-design-jobs.rss', 'Design'],
          ['categories/remote-customer-support-jobs.rss', 'Customer support'],
          ['categories/remote-sales-and-marketing-jobs.rss', 'Sales and marketing'],
          ['categories/remote-product-jobs.rss', 'Product'],
          ['categories/remote-management-and-finance-jobs.rss', 'Management and finance'],
          ['categories/all-other-remote-jobs.rss', 'Everything else'],
        ],
        undefined,
        true,
      ),
    ],
  }),
  entry({
    id: 'arbeitnow',
    name: 'Arbeitnow',
    group: GLOBAL,
    summary: 'Jobs across Europe, many offering visa sponsorship or relocation.',
    homepage: 'https://www.arbeitnow.com',
    access: 'OPEN',
    type: 'ARBEITNOW',
    tested: T,
    tags: ['europe', 'visa'],
  }),
  entry({
    id: 'jobicy',
    name: 'Jobicy',
    group: GLOBAL,
    summary: 'Remote jobs by region, industry and tag.',
    homepage: 'https://jobicy.com',
    access: 'OPEN',
    type: 'JOBICY',
    tested: T,
    tags: ['remote', 'global'],
    fields: [
      text('geo', 'Region', 'africa', 'For example usa, europe, africa, apac'),
      text('industry', 'Industry', 'dev'),
      text('tag', 'Tag', 'typescript'),
    ],
  }),
  entry({
    id: 'hackernews',
    name: 'Hacker News: Who is hiring?',
    group: GLOBAL,
    summary:
      'The monthly thread where startups post openings directly. Each comment becomes a job.',
    homepage: 'https://news.ycombinator.com',
    access: 'OPEN',
    type: 'HACKERNEWS',
    tested: T,
    tags: ['startups', 'tech'],
  }),

  // ------------------------------------------------------------------ Africa and Ethiopia
  entry({
    id: 'ethiojobs',
    name: 'EthioJobs',
    group: AFRICA,
    summary: 'Ethiopia’s largest job board: all sectors, by region.',
    homepage: 'https://ethiojobs.net',
    access: 'OPEN',
    type: 'JSON_API',
    tested: T,
    tags: ['ethiopia', 'africa'],
    fixed: {
      url: 'https://ethiojobs.net/jobs',
      format: 'next-data',
      itemsPath: 'props.pageProps.jobs.data',
      pageParam: 'page',
      idPath: 'slug',
      titlePath: 'title',
      companyPath: 'company.name',
      locationPath: 'state',
      descriptionPath: 'description',
      datePath: 'date_published',
      urlTemplate: 'https://ethiojobs.net/job/{id}',
    },
    fields: [
      num(
        'pages',
        'Pages to read (12 jobs each)',
        'Between 1 and 5. A first read of 5 pages brings the latest 60 jobs.',
      ),
    ],
    note: 'Read from the page data the site itself publishes for search engines; robots.txt is obeyed and requests are spaced out.',
  }),
  entry({
    id: 'hahu',
    name: 'Hahu Jobs',
    group: AFRICA,
    summary: 'Ethiopian jobs board and app.',
    homepage: 'https://hahu.jobs',
    access: 'LINK_ONLY',
    note: 'Hahu draws its jobs in the browser and keeps them behind a key, so there is nothing open to read automatically (its job pages carry no readable job data, and robots.txt is open but the pages are empty without scripts). Add a job from its link with "Add jobs from links" and fill in what the page shows. If Hahu gives you an export or an API key, use "Any JSON API": it will work.',
    tags: ['ethiopia', 'africa'],
  }),
  entry({
    id: 'myjobmag-ng',
    name: 'MyJobMag (Nigeria)',
    group: AFRICA,
    summary: 'Latest jobs in Nigeria, all sectors.',
    homepage: 'https://www.myjobmag.com',
    access: 'OPEN',
    type: 'RSS',
    tested: T,
    tags: ['nigeria', 'africa'],
    fixed: { feedUrl: 'https://www.myjobmag.com/jobsxml.xml', companyName: 'MyJobMag' },
  }),
  entry({
    id: 'myjobmag-ke',
    name: 'MyJobMag (Kenya)',
    group: AFRICA,
    summary: 'Latest jobs in Kenya.',
    homepage: 'https://www.myjobmag.co.ke',
    access: 'OPEN',
    type: 'RSS',
    tested: T,
    tags: ['kenya', 'africa'],
    fixed: { feedUrl: 'https://www.myjobmag.co.ke/jobsxml.xml', companyName: 'MyJobMag' },
  }),
  entry({
    id: 'africa-board',
    name: 'Another African job board',
    group: AFRICA,
    summary:
      'Jobs in Africa, Bank jobs, Careers24, Jobberman, BrighterMonday and similar sites: configure the one you use.',
    access: 'CONFIGURE',
    tested: T,
    type: 'STRUCTURED_DATA',
    tags: ['africa', 'custom'],
    fixed: {},
    fields: [
      url(
        'url',
        'Address',
        'https://example-board.com/sitemap.xml',
        'A listing page, a single job page, or the site’s sitemap. It must publish schema.org JobPosting data (most job boards do, for Google).',
      ),
      text(
        'pathContains',
        'Only addresses containing',
        '/jobs/',
        'For a sitemap: keeps only job pages.',
      ),
      text('companyName', 'Name to show', 'Example Board'),
    ],
    note: 'Works for any site that marks its jobs up for Google. Use "Test" to see what it finds before saving. If it finds nothing, the site publishes no job data: choose "Any listing page" and give the selectors, or add jobs from their links.',
  }),

  // ------------------------------------------------------------------ humanitarian
  entry({
    id: 'reliefweb',
    name: 'ReliefWeb',
    group: HUMAN,
    summary: 'Humanitarian and development jobs (UN agencies, NGOs), many in Africa.',
    homepage: 'https://reliefweb.int/jobs',
    access: 'OPEN',
    type: 'RSS',
    tested: T,
    tags: ['humanitarian', 'ngo', 'africa'],
    fixed: { feedUrl: 'https://reliefweb.int/jobs/rss.xml', companyName: 'ReliefWeb' },
    fields: [],
  }),

  // ------------------------------------------------------------------ large employers
  entry({
    id: 'google',
    name: 'Google Careers',
    group: BIG,
    summary: 'Google and its companies’ open roles, from Google’s own careers feed.',
    homepage: 'https://www.google.com/about/careers',
    access: 'OPEN',
    type: 'GOOGLE_CAREERS',
    tested: T,
    tags: ['big tech'],
    fields: [
      select('category', 'Category', [
        ['', 'All'],
        ['SOFTWARE_ENGINEERING', 'Software engineering'],
        ['HARDWARE_ENGINEERING', 'Hardware engineering'],
        ['NETWORK_ENGINEERING', 'Network engineering'],
        ['TECHNICAL_INFRASTRUCTURE_ENGINEERING', 'Technical infrastructure'],
        ['DATA_CENTER_OPERATIONS', 'Data centers'],
        ['INFORMATION_TECHNOLOGY', 'Information technology'],
        ['PRODUCT_MANAGEMENT', 'Product management'],
        ['PROGRAM_MANAGEMENT', 'Program management'],
        ['USER_EXPERIENCE', 'User experience'],
        ['TECHNICAL_SOLUTIONS', 'Technical solutions'],
        ['TECHNICAL_WRITING', 'Technical writing'],
        ['PRODUCT_SUPPORT', 'Product support'],
        ['SALES', 'Sales'],
        ['SALES_OPERATIONS', 'Sales operations'],
        ['MARKETING', 'Marketing'],
        ['PARTNERSHIPS', 'Partnerships'],
        ['BUSINESS_STRATEGY', 'Strategy'],
        ['FINANCE', 'Finance'],
        ['LEGAL', 'Legal'],
        ['PEOPLEOPS', 'People operations'],
        ['ADMINISTRATIVE', 'Administrative'],
        ['MANUFACTURING_SUPPLY_CHAIN', 'Manufacturing and supply chain'],
        ['REAL_ESTATE', 'Real estate'],
      ]),
    ],
    note: 'A very large feed (about 20 MB): read once an hour at most. Use the keyword and place filters to keep what matters.',
  }),
  entry({
    id: 'nvidia',
    name: 'NVIDIA',
    group: BIG,
    summary: 'NVIDIA’s open roles, from its Workday careers site.',
    homepage: 'https://www.nvidia.com/en-us/about-nvidia/careers/',
    access: 'OPEN',
    type: 'WORKDAY',
    tested: T,
    tags: ['big tech'],
    fixed: {
      host: 'nvidia.wd5.myworkdayjobs.com',
      tenant: 'nvidia',
      site: 'NVIDIAExternalCareerSite',
      companyName: 'NVIDIA',
    },
    fields: [text('keywords', 'Search words', 'engineer')],
  }),

  // ------------------------------------------------------------------ a company's own careers site
  entry({
    id: 'greenhouse',
    name: 'Greenhouse',
    group: ATS,
    summary:
      'Any company that hires through Greenhouse (thousands, including many African and remote-first companies).',
    homepage: 'https://www.greenhouse.com',
    access: 'OPEN',
    type: 'GREENHOUSE',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'boardToken',
        'Board name',
        'The part after boards.greenhouse.io/ in the company’s jobs address.',
        'airbnb',
      ),
      company,
    ],
  }),
  entry({
    id: 'lever',
    name: 'Lever',
    group: ATS,
    summary: 'Any company that hires through Lever.',
    homepage: 'https://www.lever.co',
    access: 'OPEN',
    type: 'LEVER',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'site',
        'Account name',
        'The part after jobs.lever.co/ in the company’s jobs address.',
        'palantir',
      ),
      select('region', 'Data region', [
        ['', 'Global'],
        ['eu', 'Europe'],
      ]),
      company,
    ],
  }),
  entry({
    id: 'ashby',
    name: 'Ashby',
    group: ATS,
    summary: 'Any company that hires through Ashby.',
    homepage: 'https://www.ashbyhq.com',
    access: 'OPEN',
    type: 'ASHBY',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'board',
        'Job board name',
        'The part after jobs.ashbyhq.com/ in the company’s jobs address.',
        'ashby',
      ),
      company,
    ],
  }),
  entry({
    id: 'workable',
    name: 'Workable',
    group: ATS,
    summary: 'Any company that hires through Workable.',
    homepage: 'https://www.workable.com',
    access: 'OPEN',
    type: 'WORKABLE',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'account',
        'Account name',
        'The part after apply.workable.com/ in the company’s jobs address.',
        'lumen5',
      ),
      company,
    ],
  }),
  entry({
    id: 'smartrecruiters',
    name: 'SmartRecruiters',
    group: ATS,
    summary: 'Any company that hires through SmartRecruiters.',
    homepage: 'https://www.smartrecruiters.com',
    access: 'OPEN',
    type: 'SMARTRECRUITERS',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'company',
        'Company identifier',
        'The part after jobs.smartrecruiters.com/ in the company’s jobs address.',
        'smartrecruiters',
      ),
      company,
    ],
  }),
  entry({
    id: 'recruitee',
    name: 'Recruitee',
    group: ATS,
    summary: 'Any company that hires through Recruitee.',
    homepage: 'https://recruitee.com',
    access: 'OPEN',
    type: 'RECRUITEE',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'company',
        'Subdomain',
        'The part before .recruitee.com in the company’s jobs address.',
        'acme',
      ),
      company,
    ],
  }),
  entry({
    id: 'breezy',
    name: 'Breezy HR',
    group: ATS,
    summary: 'Any company that hires through Breezy.',
    homepage: 'https://breezy.hr',
    access: 'OPEN',
    type: 'BREEZY',
    tested: T,
    tags: ['company'],
    fields: [
      account(
        'company',
        'Subdomain',
        'The part before .breezy.hr in the company’s jobs address.',
        'acme',
      ),
      company,
    ],
  }),
  entry({
    id: 'personio',
    name: 'Personio',
    group: ATS,
    summary: 'Any company that hires through Personio (common in Germany and Europe).',
    homepage: 'https://www.personio.com',
    access: 'OPEN',
    type: 'PERSONIO',
    tested: T,
    tags: ['company', 'europe'],
    fields: [
      account(
        'company',
        'Subdomain',
        'The part before .jobs.personio.de in the company’s jobs address.',
        'acme',
      ),
      select('domain', 'Domain', [
        ['', '.jobs.personio.de'],
        ['com', '.jobs.personio.com'],
      ]),
      company,
    ],
  }),
  entry({
    id: 'bamboohr',
    name: 'BambooHR',
    group: ATS,
    summary: 'Any company that hires through BambooHR.',
    homepage: 'https://www.bamboohr.com',
    access: 'OPEN',
    type: 'BAMBOOHR',
    tested: null,
    note: 'The interface answers correctly for real accounts, but none of the accounts tried had an open job to prove a full read with.',
    tags: ['company'],
    fields: [
      account(
        'company',
        'Subdomain',
        'The part before .bamboohr.com in the company’s jobs address.',
        'acme',
      ),
      company,
    ],
  }),
  entry({
    id: 'workday',
    name: 'Workday',
    group: ATS,
    summary: 'Banks, telecoms and large enterprises that hire through Workday.',
    homepage: 'https://www.workday.com',
    access: 'OPEN',
    type: 'WORKDAY',
    tested: T,
    tags: ['company', 'enterprise', 'banks'],
    fields: [
      text(
        'host',
        'Workday address',
        'acme.wd3.myworkdayjobs.com',
        'The host of the company’s careers page.',
        true,
      ),
      account('tenant', 'Tenant', 'The first part of that host.', 'acme'),
      account('site', 'Career site', 'The last part of the careers page address.', 'External'),
      text('keywords', 'Search words'),
      company,
    ],
  }),
  entry({
    id: 'teamtailor',
    name: 'Teamtailor',
    group: ATS,
    summary: 'Any company that hires through Teamtailor.',
    homepage: 'https://www.teamtailor.com',
    access: 'OPEN',
    type: 'RSS',
    tested: T,
    tags: ['company'],
    fixed: { feedUrl: 'https://{slug}.teamtailor.com/jobs.rss' },
    fields: [
      account(
        'slug',
        'Subdomain',
        'The part before .teamtailor.com in the company’s jobs address.',
        'acme',
      ),
      company,
    ],
  }),
  entry({
    id: 'pinpoint',
    name: 'Pinpoint',
    group: ATS,
    summary: 'Any company that hires through Pinpoint.',
    homepage: 'https://www.pinpointhq.com',
    access: 'OPEN',
    type: 'JSON_API',
    tested: T,
    tags: ['company'],
    fixed: {
      url: 'https://{slug}.pinpointhq.com/postings.json',
      itemsPath: 'data',
      idPath: 'id',
      titlePath: 'title',
      companyName: '{slug}',
      locationPath: 'location.name',
      descriptionPath: 'description',
      urlPath: 'url',
    },
    fields: [
      account(
        'slug',
        'Subdomain',
        'The part before .pinpointhq.com in the company’s jobs address.',
        'acme',
      ),
    ],
  }),

  // ------------------------------------------------------------------ niche and custom
  entry({
    id: 'rss',
    name: 'Any RSS or Atom feed',
    group: NICHE,
    summary: 'A feed from any job site, newsletter or community that publishes one.',
    access: 'CONFIGURE',
    tested: T,
    type: 'RSS',
    fields: [
      url('feedUrl', 'Feed address', 'https://example.com/jobs.rss'),
      text('companyName', 'Name to show', 'Example'),
      num(
        'maxMb',
        'Largest feed to accept (MB)',
        'Default 5. Very large feeds can be allowed up to 40.',
      ),
    ],
    tags: ['custom'],
  }),
  entry({
    id: 'structured',
    name: 'Any site that publishes job data for Google',
    group: NICHE,
    summary:
      'Reads the schema.org JobPosting data that most job sites embed, from a page or a sitemap.',
    access: 'CONFIGURE',
    tested: T,
    type: 'STRUCTURED_DATA',
    fields: [
      url(
        'url',
        'Address',
        'https://example.com/jobs/sitemap.xml',
        'A job page, a listing page or a sitemap.',
      ),
      select('mode', 'What it is', [
        ['', 'Detect from the address'],
        ['page', 'A page'],
        ['sitemap', 'A sitemap'],
      ]),
      text(
        'pathContains',
        'Only addresses containing',
        '/job/',
        'For a sitemap: keeps only job pages.',
      ),
      num(
        'maxPages',
        'Pages to read from a sitemap',
        'Newest first, between 1 and 60 (default 25).',
      ),
      text('companyName', 'Name to show'),
    ],
    note: 'Polite by design: robots.txt is obeyed and requests are spaced out.',
    tags: ['custom'],
  }),
  entry({
    id: 'json',
    name: 'Any JSON API',
    group: NICHE,
    summary:
      'Any service that answers with a list of jobs as JSON: tell JobPilot where each field is.',
    access: 'CONFIGURE',
    tested: T,
    type: 'JSON_API',
    fields: [
      url('url', 'API address', 'https://api.example.com/jobs'),
      select('format', 'Where the data is', [
        ['', 'The response is JSON'],
        ['next-data', 'Inside a Next.js page'],
      ]),
      text(
        'itemsPath',
        'Path to the list',
        'data.jobs',
        'Leave empty if the response is the list.',
      ),
      text('idPath', 'Path to the id', 'id'),
      text('titlePath', 'Path to the title', 'title', undefined, true),
      text('companyPath', 'Path to the company', 'company.name', 'Or give a fixed name below.'),
      text('companyName', 'Fixed company name'),
      text('locationPath', 'Path to the location', 'location'),
      text('descriptionPath', 'Path to the description', 'description'),
      text('urlPath', 'Path to the job link', 'url', 'Or a template below.'),
      text('urlTemplate', 'Link template', 'https://example.com/jobs/{id}'),
      text('datePath', 'Path to the date', 'posted_at'),
      text('pageParam', 'Page parameter', 'page', 'If the API pages with ?page=2.'),
      num('pages', 'Pages to read', '1 to 5.'),
    ],
    tags: ['custom'],
  }),
  entry({
    id: 'html',
    name: 'Any listing page (CSS selectors)',
    group: NICHE,
    summary:
      'A job listing page on any site: say which parts of the page are the title, company and place.',
    access: 'CONFIGURE',
    tested: T,
    type: 'HTML_LIST',
    fields: [
      url('url', 'Listing page address', 'https://example.com/jobs'),
      text(
        'itemSelector',
        'Each job is',
        '.job-card',
        'A CSS selector that matches every job on the page.',
        true,
      ),
      text('titleSelector', 'Title is', 'h3 a', undefined, true),
      text('linkSelector', 'Link is', 'h3 a', 'Defaults to the title.'),
      text('companySelector', 'Company is', '.company'),
      text('companyName', 'Fixed company name'),
      text('locationSelector', 'Place is', '.location'),
      text('descriptionSelector', 'Summary is', '.summary'),
      text('dateSelector', 'Date is', 'time'),
      text('pageParam', 'Page parameter', 'page'),
      num('pages', 'Pages to read', '1 to 5.'),
    ],
    note: 'Polite by design: robots.txt is obeyed and requests are spaced out. Use "Test" to see what it finds.',
    tags: ['custom'],
  }),

  // ------------------------------------------------------------------ forbidden to automate
  entry({
    id: 'linkedin',
    name: 'LinkedIn',
    group: BLOCKED,
    summary: 'The largest professional network.',
    homepage: 'https://www.linkedin.com/jobs',
    access: 'LINK_ONLY',
    note: 'LinkedIn has no open job feed and its terms forbid automated collection, so JobPilot does not scrape it. What works: open a job in your browser, copy its link, and use "Add a job from a link". Or paste a LinkedIn job-alert email into "Add jobs from pasted text" and every job link in it is added.',
    tags: ['global'],
  }),
  entry({
    id: 'glassdoor',
    name: 'Glassdoor',
    group: BLOCKED,
    summary: 'Jobs with company reviews and pay.',
    homepage: 'https://www.glassdoor.com/Job',
    access: 'LINK_ONLY',
    note: 'Glassdoor blocks automated access and offers no public feed. Add a job by pasting its text or its link.',
    tags: ['global'],
  }),
  entry({
    id: 'indeed',
    name: 'Indeed',
    group: BLOCKED,
    summary: 'The largest job search engine.',
    homepage: 'https://www.indeed.com',
    access: 'LINK_ONLY',
    note: 'Indeed closed its public feed and forbids automated collection. Add jobs from their links, or paste an Indeed alert email.',
    tags: ['global'],
  }),
  entry({
    id: 'bayt',
    name: 'Bayt',
    group: BLOCKED,
    summary: 'Jobs across the Middle East and North Africa.',
    homepage: 'https://www.bayt.com',
    access: 'LINK_ONLY',
    note: 'Bayt blocks automated access (it answers 403) and has no open feed. Add jobs from their links or by pasting their text.',
    tags: ['mena'],
  }),
];

export function entryById(id: string): CatalogEntry | undefined {
  return CATALOG.find((e) => e.id === id);
}

/** The settings a catalog entry produces from what the person typed, or the first problem with it. */
export function buildConfig(
  e: CatalogEntry,
  input: Record<string, string>,
): { config: Record<string, string> } | { problem: string } {
  if (!e.type)
    return {
      problem: `${e.name} cannot be read automatically: ${e.note ?? 'add its jobs from their links'}`,
    };
  const values: Record<string, string> = {};
  for (const f of e.fields) {
    const v = (input[f.key] ?? '').trim();
    if (!v) {
      if (f.required) return { problem: `${f.label} is required` };
      continue;
    }
    if (f.kind === 'select' && !f.options!.some((o) => o.value === v))
      return { problem: `${f.label} is not one of the choices` };
    if (f.kind === 'number' && !/^\d{1,3}$/.test(v))
      return { problem: `${f.label} must be a number` };
    values[f.key] = v;
  }
  // A typed word is encoded for use inside an address; a choice from a fixed list is already the right text.
  const fill = (s: string) =>
    s.replace(/\{(\w+)\}/g, (whole, k: string) => {
      const field = e.fields.find((f) => f.key === k);
      // {id} and the like belong to the connector and are filled for each job, not here.
      if (!field) return whole;
      return field.kind === 'select' ? (values[k] ?? '') : encodeURIComponent(values[k] ?? '');
    });
  const config: Record<string, string> = {};
  for (const [k, v] of Object.entries(e.fixed)) config[k] = fill(v);
  for (const [k, v] of Object.entries(values)) config[k] = v;
  // A field that is only a placeholder in a template (slug) is not itself a setting.
  for (const f of e.fields) {
    if (Object.values(e.fixed).some((v) => v.includes(`{${f.key}}`)) && !(f.key in e.fixed))
      delete config[f.key];
  }
  const problem = CONNECTORS[e.type].validateConfig(config);
  return problem ? { problem } : { config };
}
