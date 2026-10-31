import {
  asArray,
  dateOf,
  defaultCompany,
  getJson,
  mapLimit,
  MAX_POSTINGS,
  placeOf,
  requireSlug,
  text,
  xml,
  type JobSourceConnector,
  type Loose,
} from './util.js';

/**
 * The public job-posting interfaces that applicant-tracking systems publish on purpose, so that a
 * company's own jobs can be shown elsewhere. Each reads one company's board by its account name.
 */

export const leverConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'site', 'Lever account name (the part after jobs.lever.co/)'),
  async fetch(c, f) {
    const host = c['region'] === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const list = await getJson<Loose[]>(f, `https://${host}/v0/postings/${c['site']}?mode=json`);
    return asArray(list)
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: String(j['id']),
        title: text(j['text']),
        company: defaultCompany(c, c['site']!),
        location: placeOf(
          [text(j['categories']?.location) || text(j['categories']?.allLocations)],
          j['workplaceType'] === 'remote',
        ),
        description: [
          text(j['descriptionPlain'] ?? j['description']),
          ...asArray<Loose>(j['lists']).map((l) => `${text(l['text'])}\n${text(l['content'])}`),
          text(j['additionalPlain']),
          j['salaryRange']
            ? `Salary: ${j['salaryRange'].min} - ${j['salaryRange'].max} ${j['salaryRange'].currency ?? ''}`
            : '',
        ].join('\n\n'),
        url: text(j['hostedUrl']) || null,
        postedAt: dateOf(j['createdAt']),
      }));
  },
};

export const ashbyConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'board', 'Ashby job board name (the part after jobs.ashbyhq.com/)'),
  async fetch(c, f) {
    const body = await getJson(
      f,
      `https://api.ashbyhq.com/posting-api/job-board/${c['board']}?includeCompensation=true`,
    );
    return asArray<Loose>(body['jobs'])
      .filter((j) => j['isListed'] !== false)
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['title']),
        company: defaultCompany(c, c['board']!),
        location: placeOf(
          [text(j['location'])],
          j['isRemote'] === true || j['workplaceType'] === 'Remote',
        ),
        description: [
          text(j['descriptionPlain'] ?? j['descriptionHtml']),
          text(j['compensation']?.compensationTierSummary),
        ].join('\n\n'),
        url: text(j['jobUrl']) || null,
        postedAt: dateOf(j['publishedAt']),
      }));
  },
};

export const workableConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'account', 'Workable account name (the part after apply.workable.com/)'),
  async fetch(c, f) {
    const body = await getJson(
      f,
      `https://apply.workable.com/api/v1/widget/accounts/${c['account']}?details=true`,
    );
    return asArray<Loose>(body['jobs'])
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['shortcode'] ?? j['id']),
        title: text(j['title']),
        company: defaultCompany(c, text(body['name']) || c['account']!),
        location: placeOf(
          [text(j['city']), text(j['state']), text(j['country'])],
          j['telecommuting'] === true,
        ),
        description: text(j['description']),
        url: text(j['url'] ?? j['shortlink']) || null,
        postedAt: dateOf(j['published_on'] ?? j['created_at']),
      }));
  },
};

export const smartRecruitersConnector: JobSourceConnector = {
  validateConfig: (c) => requireSlug(c, 'company', 'SmartRecruiters company identifier'),
  async fetch(c, f) {
    const found: Loose[] = [];
    for (let offset = 0; offset < 300; offset += 100) {
      const page = await getJson(
        f,
        `https://api.smartrecruiters.com/v1/companies/${c['company']}/postings?limit=100&offset=${offset}`,
      );
      const rows = asArray<Loose>(page['content']);
      found.push(...rows);
      if (rows.length < 100) break;
    }
    // The list has no description: read the first few postings in full so matching has something to work with.
    const detail = await mapLimit(found.slice(0, 40), 4, async (j) => {
      try {
        const d = await getJson(
          f,
          `https://api.smartrecruiters.com/v1/companies/${c['company']}/postings/${j['id']}`,
        );
        return Object.values((d['jobAd']?.sections ?? {}) as Loose)
          .map((s) => text((s as Loose)['text']))
          .join('\n\n');
      } catch {
        return '';
      }
    });
    return found.slice(0, MAX_POSTINGS).map((j, i) => ({
      externalId: text(j['id']),
      title: text(j['name']),
      company: defaultCompany(c, text(j['company']?.name) || c['company']!),
      location: placeOf(
        [
          text(j['location']?.city),
          text(j['location']?.region),
          text(j['location']?.country)?.toUpperCase(),
        ],
        j['location']?.remote === true,
      ),
      description: detail[i] ?? '',
      url: `https://jobs.smartrecruiters.com/${c['company']}/${j['id']}`,
      postedAt: dateOf(j['releasedDate']),
    }));
  },
};

export const recruiteeConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'company', 'Recruitee subdomain (the part before .recruitee.com)'),
  async fetch(c, f) {
    const body = await getJson(f, `https://${c['company']}.recruitee.com/api/offers/`);
    return asArray<Loose>(body['offers'])
      .filter((o) => o['status'] === undefined || o['status'] === 'published')
      .slice(0, MAX_POSTINGS)
      .map((o) => ({
        externalId: text(o['id']),
        title: text(o['title']),
        company: defaultCompany(c, text(o['company_name']) || c['company']!),
        location: placeOf([text(o['city']), text(o['country'])], o['remote'] === true),
        description: [text(o['description']), text(o['requirements'])].join('\n\n'),
        url: text(o['careers_url']) || null,
        postedAt: dateOf(o['published_at'] ?? o['created_at']),
      }));
  },
};

export const breezyConnector: JobSourceConnector = {
  validateConfig: (c) => requireSlug(c, 'company', 'Breezy subdomain (the part before .breezy.hr)'),
  async fetch(c, f) {
    const list = await getJson<Loose[]>(f, `https://${c['company']}.breezy.hr/json`);
    return asArray(list)
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['name']),
        company: defaultCompany(c, text(j['company']?.name) || c['company']!),
        location: placeOf(
          [
            text(j['location']?.city),
            text(j['location']?.state?.name),
            text(j['location']?.country?.name),
          ],
          j['location']?.is_remote === true,
        ),
        description: [text(j['department']), text(j['type']?.name), text(j['description'])]
          .filter(Boolean)
          .join('\n\n'),
        url: text(j['url']) || null,
        postedAt: dateOf(j['published_date']),
      }));
  },
};

export const personioConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'company', 'Personio subdomain (the part before .jobs.personio.de)'),
  async fetch(c, f) {
    const host = c['domain'] === 'com' ? 'jobs.personio.com' : 'jobs.personio.de';
    const body = await f.fetchText(`https://${c['company']}.${host}/xml`, {
      headers: { accept: 'application/xml' },
    });
    const doc = xml.parse(body) as Loose;
    return asArray<Loose>(doc['workzag-jobs']?.position)
      .slice(0, MAX_POSTINGS)
      .map((p) => ({
        externalId: text(p['id']),
        title: text(p['name']),
        company: defaultCompany(c, text(p['subcompany']) || c['company']!),
        location: placeOf([text(p['office'])]),
        description: asArray<Loose>(p['jobDescriptions']?.jobDescription)
          .map((d) => `${text(d['name'])}\n${text(d['value'])}`)
          .join('\n\n'),
        url: `https://${c['company']}.${host}/job/${text(p['id'])}`,
        postedAt: dateOf(text(p['createdAt'])),
      }));
  },
};

export const bambooConnector: JobSourceConnector = {
  validateConfig: (c) =>
    requireSlug(c, 'company', 'BambooHR subdomain (the part before .bamboohr.com)'),
  async fetch(c, f) {
    const body = await getJson(f, `https://${c['company']}.bamboohr.com/careers/list`);
    return asArray<Loose>(body['result'])
      .slice(0, MAX_POSTINGS)
      .map((j) => ({
        externalId: text(j['id']),
        title: text(j['jobOpeningName']),
        company: defaultCompany(c, c['company']!),
        location: placeOf(
          [text(j['location']?.city), text(j['location']?.state)],
          text(j['locationType']) === '1' || j['isRemote'] === true,
        ),
        description: [text(j['departmentLabel']), text(j['employmentStatusLabel'])]
          .filter(Boolean)
          .join('\n'),
        url: `https://${c['company']}.bamboohr.com/careers/${j['id']}`,
        postedAt: null,
      }));
  },
};

const HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.myworkdayjobs\.com$/i;
export const workdayConnector: JobSourceConnector = {
  validateConfig(c) {
    if (!c['host'] || !HOST.test(c['host']))
      return 'host must be the Workday address, like nvidia.wd5.myworkdayjobs.com';
    return (
      requireSlug(c, 'tenant', 'Workday tenant (the first part of the host)') ??
      requireSlug(c, 'site', 'Workday career-site name (the last part of its address)')
    );
  },
  async fetch(c, f) {
    const url = `https://${c['host']}/wday/cxs/${c['tenant']}/${c['site']}/jobs`;
    const out = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const page = await getJson(f, url, {
        method: 'POST',
        body: JSON.stringify({
          appliedFacets: {},
          limit: 20,
          offset,
          searchText: c['keywords'] ?? '',
        }),
      });
      const rows = asArray<Loose>(page['jobPostings']);
      for (const j of rows) {
        out.push({
          externalId: text(j['bulletFields']?.[0] ?? j['externalPath']),
          title: text(j['title']),
          company: defaultCompany(c, c['tenant']!),
          location: placeOf([text(j['locationsText'])]),
          description: asArray(j['bulletFields']).map(text).join('\n'),
          url: `https://${c['host']}/${c['site']}${text(j['externalPath'])}`,
          postedAt: null,
        });
      }
      if (rows.length < 20) break;
    }
    return out.slice(0, MAX_POSTINGS);
  },
};
