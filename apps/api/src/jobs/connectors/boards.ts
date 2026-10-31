import { toPlainText } from '../normalize.js';
import {
  asArray,
  dateOf,
  getJson,
  MAX_POSTINGS,
  placeOf,
  text,
  xml,
  type JobSourceConnector,
  type Loose,
} from './util.js';

/** Job boards and aggregators that publish an open feed of their own listings for others to read. */

export const remotiveConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const q = new URLSearchParams({ limit: '200' });
    if (c['category']) q.set('category', c['category']);
    if (c['search']) q.set('search', c['search']);
    const body = await getJson(f, `https://remotive.com/api/remote-jobs?${q}`);
    return asArray<Loose>(body['jobs'])
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['title']),
        company: text(j['company_name']),
        location: placeOf([text(j['candidate_required_location'])], true),
        description: [
          text(j['description']),
          text(j['salary']) ? `Salary: ${text(j['salary'])}` : '',
        ].join('\n\n'),
        url: text(j['url']) || null,
        postedAt: dateOf(j['publication_date']),
      }));
  },
};

export const remoteOkConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const list = await getJson<Loose[]>(f, 'https://remoteok.com/api');
    // The first entry is the legal notice, not a job.
    return asArray(list)
      .filter((j) => j['position'])
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['position']),
        company: text(j['company']),
        location: placeOf([text(j['location'])], true),
        description: [
          text(j['description']),
          text(j['tags']),
          j['salary_min'] ? `Salary: ${j['salary_min']} - ${j['salary_max']} USD` : '',
        ].join('\n\n'),
        url: text(j['url']) || text(j['apply_url']) || null,
        postedAt: dateOf(j['epoch'] ?? j['date']),
      }));
  },
};

export const himalayasConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const out: Loose[] = [];
    let cursor = '';
    for (let page = 0; page < 5; page += 1) {
      const body = await getJson(
        f,
        `https://himalayas.app/jobs/api?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      out.push(...asArray<Loose>(body['jobs']));
      cursor = text(body['nextCursor']);
      if (!cursor) break;
    }
    return out.slice(0, MAX_POSTINGS).map((j) => ({
      externalId: text(j['guid'] ?? j['applicationLink']),
      title: text(j['title']),
      company: text(j['companyName']),
      location: placeOf([text(j['locationRestrictions'])], true),
      description: [
        text(j['description'] ?? j['excerpt']),
        text(j['seniority']),
        j['minSalary']
          ? `Salary: ${j['minSalary']} - ${j['maxSalary']} ${text(j['currency'])}`
          : '',
      ].join('\n\n'),
      url: text(j['applicationLink'] ?? j['guid']) || null,
      postedAt: dateOf(j['pubDate']),
    }));
  },
};

export const arbeitnowConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const out: Loose[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const body = await getJson(f, `https://www.arbeitnow.com/api/job-board-api?page=${page}`);
      const rows = asArray<Loose>(body['data']);
      out.push(...rows);
      if (rows.length === 0) break;
    }
    return out.slice(0, MAX_POSTINGS).map((j) => ({
      externalId: text(j['slug']),
      title: text(j['title']),
      company: text(j['company_name']),
      location: placeOf([text(j['location'])], j['remote'] === true),
      description: [text(j['description']), text(j['tags'])].join('\n\n'),
      url: text(j['url']) || null,
      postedAt: dateOf(j['created_at']),
    }));
  },
};

export const jobicyConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const q = new URLSearchParams({ count: '100' });
    for (const key of ['geo', 'industry', 'tag']) if (c[key]) q.set(key, c[key]!);
    const body = await getJson(f, `https://jobicy.com/api/v2/remote-jobs?${q}`);
    return asArray<Loose>(body['jobs'])
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['jobTitle']),
        company: text(j['companyName']),
        location: placeOf([text(j['jobGeo'])], true),
        description: [
          text(j['jobDescription'] ?? j['jobExcerpt']),
          text(j['jobLevel']),
          j['salaryMin']
            ? `Salary: ${j['salaryMin']} - ${j['salaryMax']} ${text(j['salaryCurrency'])}`
            : '',
        ].join('\n\n'),
        url: text(j['url']) || null,
        postedAt: dateOf(j['pubDate']),
      }));
  },
};

// Words that make a header part look like a role, a mere term of the job, or a place.
const ROLE_WORDS =
  /engineer|developer|designer|manager|scientist|analyst|architect|\blead\b|director|head of|founder|devops|\bsre\b|researcher|specialist|consultant|recruiter|writer|sales|marketing|product|support|intern|\bcto\b|\bvp\b/i;
const TERMS_ONLY =
  /^(remote|onsite|on-site|hybrid|full[- ]?time|part[- ]?time|contract|visa|relocation|equity|usd|eur|gbp|[$€£\d])/i;
const PLACE_WORDS =
  /remote|onsite|on-site|hybrid|[A-Z][a-z]+,? ?[A-Z]{2}\b|london|berlin|nairobi|lagos|cape town|accra|addis|new york|san francisco|toronto|paris|amsterdam|\busa\b|\buk\b|\beu\b|worldwide/i;

/** The monthly "Ask HN: Who is hiring?" thread: each top-level comment is one company's posting. */
export const hackerNewsConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const search = await getJson(
      f,
      'https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=6',
    );
    const story = asArray<Loose>(search['hits']).find((h) =>
      /who is hiring/i.test(text(h['title'])),
    );
    if (!story) throw new Error('The latest "Who is hiring?" thread was not found');
    const thread = await getJson(f, `https://hn.algolia.com/api/v1/items/${story['objectID']}`);
    return asArray<Loose>(thread['children'])
      .filter((k) => k['text'])
      .slice(0, MAX_POSTINGS)
      .map((k) => {
        const plain = toPlainText(text(k['text']));
        const first = plain.split('\n')[0] ?? '';
        const parts = first
          .split('|')
          .map((p) => p.trim())
          .filter(Boolean);
        const remote = /remote/i.test(first);
        const company = parts[0] ?? 'Unknown';
        const rest = parts.slice(1);
        const title =
          rest.find((p) => p.length <= 80 && ROLE_WORDS.test(p) && !TERMS_ONLY.test(p)) ??
          rest.find((p) => p.length <= 80 && !TERMS_ONLY.test(p) && !PLACE_WORDS.test(p)) ??
          'Open role (see the post)';
        return {
          externalId: text(k['id']),
          title,
          company,
          location: placeOf([rest.find((p) => PLACE_WORDS.test(p) && p !== title)], remote),
          description: plain,
          url: `https://news.ycombinator.com/item?id=${k['id']}`,
          postedAt: dateOf(k['created_at']),
        };
      })
      .filter((p) => p.company.length < 90);
  },
};

/** Google's own careers feed: one very large XML file, so it is read with a higher size limit and trimmed to the newest postings. */
export const googleCareersConnector: JobSourceConnector = {
  validateConfig: () => null,
  async fetch(c, f) {
    const body = await f.fetchText(
      'https://www.google.com/about/careers/applications/jobs/feed.xml',
      { maxBytes: 40 * 1024 * 1024 },
    );
    const doc = xml.parse(body) as Loose;
    const want = (c['category'] ?? '').toUpperCase();
    return asArray<Loose>(doc['jobs']?.job)
      .filter(
        (j) =>
          !want ||
          asArray(j['categories']?.category ?? j['category']).some(
            (c) => text(c).toUpperCase() === want,
          ),
      )
      .sort((a, b) => Date.parse(text(b['published'])) - Date.parse(text(a['published'])))
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['jobid']),
        title: text(j['title']),
        company: text(j['employer']) || 'Google',
        location: placeOf([text(j['locations'])]),
        description: toPlainText(text(j['description'])),
        url: text(j['url']) || null,
        postedAt: dateOf(text(j['published'])),
      }));
  },
};
