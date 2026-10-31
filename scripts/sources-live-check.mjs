/**
 * Reads every kind of job source in the catalog from the REAL internet, once, politely, and says what came back.
 * This is how the catalog's "tested" dates are earned. Build the API first (pnpm --filter @jobpilot/api build).
 *
 *   node scripts/sources-live-check.mjs            all entries
 *   node scripts/sources-live-check.mjs lever rss  only these
 *
 * Each entry has a few real accounts to try; the first that returns jobs is the proof. Nothing is saved.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const dist = (p) => import(pathToFileURL(resolve('apps/api/dist', p)).href);
const { CATALOG, buildConfig } = await dist('jobs/catalog.js');
const { CONNECTORS } = await dist('jobs/connectors/index.js');
const { HttpJobFeedFetcher } = await dist('jobs/feeds.js');

/** Real examples per catalog entry. Several accounts are listed because companies move between platforms. */
const TRY = {
  remotive: [{ category: 'software-dev' }],
  remoteok: [{}],
  himalayas: [{}],
  wwr: [{ category: 'categories/remote-programming-jobs.rss' }],
  arbeitnow: [{}],
  jobicy: [{ geo: 'africa' }, {}],
  hackernews: [{}],
  ethiojobs: [{ pages: '2' }],
  'myjobmag-ng': [{}],
  'myjobmag-ke': [{}],
  reliefweb: [{}],
  google: [{ category: 'SOFTWARE_ENGINEERING' }],
  nvidia: [{ keywords: 'engineer' }],
  greenhouse: [{ boardToken: 'airbnb' }, { boardToken: 'stripe' }, { boardToken: 'cloudflare' }],
  lever: [{ site: 'palantir' }, { site: 'spotify' }],
  ashby: [{ board: 'ashby' }, { board: 'notion' }, { board: 'ramp' }],
  workable: [{ account: 'huggingface' }, { account: 'frontify' }],
  smartrecruiters: [{ company: 'smartrecruiters' }, { company: 'Visa' }],
  recruitee: [{ company: 'recruitee' }, { company: 'bunq' }, { company: 'mollie' }],
  breezy: [{ company: 'breezy' }, { company: 'hotjar' }],
  personio: [{ company: 'personio' }, { company: 'tado' }],
  bamboohr: [{ company: 'zapier' }],
  workday: [
    {
      host: 'nvidia.wd5.myworkdayjobs.com',
      tenant: 'nvidia',
      site: 'NVIDIAExternalCareerSite',
      keywords: 'engineer',
    },
  ],
  teamtailor: [{ slug: 'career' }, { slug: 'karriere' }],
  pinpoint: [{ slug: 'cazoo' }, { slug: 'thoughtmachine' }, { slug: 'lendable' }],
  rss: [
    {
      feedUrl: 'https://weworkremotely.com/categories/remote-design-jobs.rss',
      companyName: 'We Work Remotely',
    },
  ],
  structured: [
    { url: 'https://ethiojobs.net/job/NQveIFV8FM-spare-part-sales', companyName: 'EthioJobs' },
    { url: 'https://ethiojobs.net/jobs', companyName: 'EthioJobs' },
  ],
  'africa-board': [
    {
      url: 'https://ethiojobs.net/sitemap-jobs.xml',
      pathContains: '/job/',
      maxPages: '3',
      companyName: 'EthioJobs',
    },
  ],
  json: [
    {
      url: 'https://remotive.com/api/remote-jobs?limit=5',
      itemsPath: 'jobs',
      idPath: 'id',
      titlePath: 'title',
      companyPath: 'company_name',
      locationPath: 'candidate_required_location',
      descriptionPath: 'description',
      urlPath: 'url',
      datePath: 'publication_date',
    },
  ],
  html: [
    {
      url: 'https://news.ycombinator.com/jobs',
      itemSelector: '.athing',
      titleSelector: '.titleline a',
      companyName: 'Hacker News',
    },
  ],
};

const only = process.argv.slice(2);
const fetcher = new HttpJobFeedFetcher();
const rows = [];
for (const entry of CATALOG) {
  if (only.length && !only.includes(entry.id)) continue;
  if (!entry.type) {
    rows.push({ id: entry.id, result: 'link only (by design)', ms: 0 });
    continue;
  }
  const attempts = TRY[entry.id];
  if (!attempts) {
    rows.push({ id: entry.id, result: 'NO EXAMPLE', ms: 0 });
    continue;
  }
  let last = '';
  let done = false;
  for (const values of attempts) {
    const started = Date.now();
    try {
      const built = buildConfig(entry, values);
      if ('problem' in built) throw new Error(`settings: ${built.problem}`);
      const postings = await CONNECTORS[entry.type].fetch(built.config, fetcher);
      const first = postings[0];
      rows.push({
        id: entry.id,
        result: postings.length > 0 ? `OK ${postings.length} jobs` : 'EMPTY',
        sample: first
          ? `${first.title} | ${first.company} | ${first.location ?? '-'} | ${first.url ?? '-'}`
          : '',
        used: JSON.stringify(values),
        ms: Date.now() - started,
      });
      done = postings.length > 0;
      if (done) break;
      rows.pop();
      last = 'EMPTY';
    } catch (error) {
      last = String(error.message).slice(0, 160);
    }
  }
  if (!done && !rows.some((r) => r.id === entry.id && r.result.startsWith('OK'))) {
    const hit = rows.find((r) => r.id === entry.id);
    if (!hit) rows.push({ id: entry.id, result: `FAILED: ${last}`, ms: 0 });
  }
}
for (const r of rows) {
  console.log(
    `${r.result.startsWith('OK') ? 'PASS' : r.result.startsWith('link') ? 'LINK' : 'FAIL'}  ${r.id.padEnd(16)} ${r.result}${r.ms ? ` (${r.ms} ms)` : ''}`,
  );
  if (r.sample) console.log(`      ${r.sample.slice(0, 200)}`);
}
const failed = rows.filter((r) => !r.result.startsWith('OK') && !r.result.startsWith('link'));
console.log(
  `\n${rows.filter((r) => r.result.startsWith('OK')).length} read, ${failed.length} did not.`,
);
process.exitCode = failed.length ? 1 : 0;
