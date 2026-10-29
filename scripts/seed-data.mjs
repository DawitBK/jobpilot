// The demo world: who they are, what they know, which jobs exist and where each application ends up.
// Everything here is synthetic: invented people, invented companies, reserved `.test` addresses.

export const DOMAIN = 'northwind-talent.test';

/** A recruiting agency (the main workspace), with every role in it. */
export const AGENCY = { name: 'Northwind Talent Partners', owner: 'olivia.owner', plan: 'TEAM' };
/** A second, unrelated agency: proves one workspace cannot see another, and gives one person two workspaces to choose from. */
export const OTHER_AGENCY = { name: 'Globex Recruiting', owner: 'gina.globex', plan: 'PRO' };

export const PEOPLE = [
  { key: 'olivia.owner', name: 'Olivia Okafor', role: 'OWNER' },
  { key: 'adam.admin', name: 'Adam Abate', role: 'ADMIN' },
  { key: 'rita.recruiter', name: 'Rita Romero', role: 'RECRUITER', also: 'globex' },
  { key: 'hana.manager', name: 'Hana Haile', role: 'HIRING_MANAGER' },
  { key: 'aron.analyst', name: 'Aron Alemu', role: 'ANALYST' },
  { key: 'ana.bekele', name: 'Ana Bekele', role: 'CANDIDATE' },
  { key: 'ben.carter', name: 'Ben Carter', role: 'CANDIDATE' },
  { key: 'chloe.dlamini', name: 'Chloe Dlamini', role: 'CANDIDATE' },
  { key: 'david.eshete', name: 'David Eshete', role: 'CANDIDATE' },
  // Registered with nothing else: the empty state a brand-new person sees.
  { key: 'new.user', name: 'Nia Newcomer', role: null },
  { key: 'gina.globex', name: 'Gina Globex', role: null },
];

const skill = (skillName, category, proficiency, yearsExperience) => ({
  skillName,
  category,
  proficiency,
  yearsExperience,
});

/** Career graphs of the four candidates. */
/** The person who runs the workspace seeded with SEED_INTO_TOKEN: a synthetic career, so their own dashboard is full too. */
export const SELF = { key: 'owner.demo', name: 'Platform Administrator', role: 'CANDIDATE' };

export const PROFILES = {
  'owner.demo': {
    patch: {
      headline: 'Full-stack and platform engineer: TypeScript, PostgreSQL, Docker',
      summary:
        'Eight years shipping web products end to end and running them in production. Comfortable from the schema to the pipeline.',
      targetRoles: ['Senior Backend Engineer', 'Platform Engineer', 'Full-stack Engineer'],
      targetLocations: ['Remote'],
      salaryMin: 90000,
      salaryMax: 130000,
      workAuthStatus: 'CITIZEN',
      remotePref: 'REMOTE_ONLY',
      relocationOk: false,
    },
    skills: [
      skill('typescript', 'BACKEND', 'EXPERT', 8),
      skill('node', 'BACKEND', 'EXPERT', 8),
      skill('postgresql', 'DATABASE', 'ADVANCED', 7),
      skill('react', 'FRONTEND', 'ADVANCED', 6),
      skill('docker', 'DEVOPS', 'ADVANCED', 6),
      skill('aws', 'DEVOPS', 'ADVANCED', 5),
      skill('kubernetes', 'DEVOPS', 'INTERMEDIATE', 3),
      skill('terraform', 'DEVOPS', 'INTERMEDIATE', 3),
    ],
    experience: [
      {
        companyName: 'Contoso Labs',
        title: 'Lead Platform Engineer',
        startDate: '2021-01-01',
        description:
          'Led the move of a monolith to containers; cut deploy time from an hour to six minutes.',
        technologies: ['typescript', 'docker', 'kubernetes', 'terraform'],
      },
      {
        companyName: 'Fabrikam Payments',
        title: 'Senior Full-stack Engineer',
        startDate: '2017-03-01',
        endDate: '2020-12-31',
        description: 'Built the merchant dashboard and the ledger API behind it.',
        technologies: ['react', 'node', 'postgresql'],
      },
    ],
    education: [
      {
        institution: 'Addis Ababa University',
        degree: 'BSc',
        field: 'Computer Science',
        startDate: '2012-09-01',
        endDate: '2016-07-01',
      },
    ],
    projects: [
      {
        name: 'Single sign-on gateway',
        description: 'OpenID Connect gateway used by six internal applications.',
        technologies: ['typescript', 'postgresql'],
        url: 'https://example.test/sso-gateway',
      },
    ],
  },
  'ana.bekele': {
    patch: {
      headline: 'Senior backend engineer: TypeScript, Node, PostgreSQL',
      summary:
        'Seven years building payment and logistics APIs. Prefers small teams, clear ownership and boring, reliable databases.',
      targetRoles: ['Senior Backend Engineer', 'Staff Backend Engineer'],
      targetLocations: ['Remote'],
      salaryMin: 85000,
      salaryMax: 125000,
      workAuthStatus: 'CITIZEN',
      remotePref: 'REMOTE_ONLY',
      relocationOk: false,
    },
    skills: [
      skill('typescript', 'BACKEND', 'EXPERT', 7),
      skill('node', 'BACKEND', 'EXPERT', 7),
      skill('postgresql', 'DATABASE', 'ADVANCED', 6),
      skill('aws', 'DEVOPS', 'ADVANCED', 5),
      skill('docker', 'DEVOPS', 'ADVANCED', 5),
      skill('redis', 'DATABASE', 'INTERMEDIATE', 3),
      skill('graphql', 'BACKEND', 'INTERMEDIATE', 3),
      skill('communication', 'SOFT', 'ADVANCED', 7),
    ],
    experience: [
      {
        companyName: 'Tailspin Logistics',
        title: 'Senior Backend Engineer',
        startDate: '2021-03-01',
        description:
          'Owned the shipment-tracking API (12k requests per minute) and its PostgreSQL schema.',
        technologies: ['typescript', 'node', 'postgresql', 'aws'],
      },
      {
        companyName: 'Wingtip Commerce',
        title: 'Backend Engineer',
        startDate: '2018-06-01',
        endDate: '2021-02-28',
        description:
          'Built the order and invoicing services; introduced contract tests between services.',
        technologies: ['node', 'postgresql', 'docker'],
      },
    ],
    education: [
      {
        institution: 'Addis Ababa University',
        degree: 'BSc',
        field: 'Computer Science',
        startDate: '2013-09-01',
        endDate: '2017-07-01',
      },
    ],
    projects: [
      {
        name: 'Open-source job-queue library',
        description:
          'A small, well-tested Postgres-backed queue with retries and visibility timeouts.',
        technologies: ['typescript', 'postgresql'],
        url: 'https://example.test/ana/queue',
      },
    ],
  },
  'ben.carter': {
    patch: {
      headline: 'Frontend engineer who ships accessible interfaces',
      summary:
        'Five years in product teams. React and Next.js every day, with a habit of fixing the design system.',
      targetRoles: ['Frontend Engineer', 'Full-stack Engineer'],
      targetLocations: ['Remote', 'London'],
      salaryMin: 60000,
      salaryMax: 90000,
      workAuthStatus: 'NEEDS_SPONSORSHIP',
      remotePref: 'HYBRID',
      relocationOk: true,
    },
    skills: [
      skill('react', 'FRONTEND', 'EXPERT', 5),
      skill('typescript', 'FRONTEND', 'ADVANCED', 5),
      skill('next.js', 'FRONTEND', 'ADVANCED', 3),
      skill('css', 'FRONTEND', 'ADVANCED', 6),
      skill('accessibility', 'FRONTEND', 'ADVANCED', 4),
      skill('graphql', 'BACKEND', 'INTERMEDIATE', 2),
      skill('node', 'BACKEND', 'INTERMEDIATE', 2),
    ],
    experience: [
      {
        companyName: 'Fabrikam Payments',
        title: 'Frontend Engineer',
        startDate: '2020-02-01',
        description: 'Led the checkout redesign; cut the main bundle by 40% and reached WCAG AA.',
        technologies: ['react', 'typescript', 'next.js'],
      },
      {
        companyName: 'Proseware Studio',
        title: 'Junior Web Developer',
        startDate: '2018-09-01',
        endDate: '2020-01-31',
        description: 'Marketing sites and a component library for a design agency.',
        technologies: ['react', 'css'],
      },
    ],
    education: [
      {
        institution: 'University of Nairobi',
        degree: 'BSc',
        field: 'Information Systems',
        startDate: '2014-09-01',
        endDate: '2018-06-01',
      },
    ],
    projects: [
      {
        name: 'Accessible component kit',
        description: 'Keyboard-first React components with a published audit.',
        technologies: ['react', 'typescript', 'accessibility'],
        url: 'https://example.test/ben/kit',
      },
    ],
  },
  'chloe.dlamini': {
    patch: {
      headline: 'Data engineer: pipelines people can trust',
      summary: 'Four years of analytics engineering. SQL first, Python when needed, tests always.',
      targetRoles: ['Data Engineer', 'Analytics Engineer'],
      targetLocations: ['Remote', 'Johannesburg'],
      salaryMin: 55000,
      salaryMax: 85000,
      workAuthStatus: 'CITIZEN',
      remotePref: 'FLEXIBLE',
      relocationOk: true,
    },
    skills: [
      skill('sql', 'DATABASE', 'EXPERT', 4),
      skill('python', 'BACKEND', 'ADVANCED', 4),
      skill('dbt', 'DATABASE', 'ADVANCED', 3),
      skill('airflow', 'DEVOPS', 'INTERMEDIATE', 3),
      skill('spark', 'BACKEND', 'INTERMEDIATE', 2),
      skill('postgresql', 'DATABASE', 'ADVANCED', 4),
    ],
    experience: [
      {
        companyName: 'Adatum Analytics',
        title: 'Data Engineer',
        startDate: '2022-01-01',
        description:
          'Rebuilt the nightly warehouse load in dbt; failures dropped from weekly to quarterly.',
        technologies: ['sql', 'dbt', 'airflow', 'python'],
      },
      {
        companyName: 'Lucerne Health',
        title: 'Data Analyst',
        startDate: '2020-03-01',
        endDate: '2021-12-31',
        description: 'Clinic reporting in SQL and Python.',
        technologies: ['sql', 'python'],
      },
    ],
    education: [
      {
        institution: 'University of Cape Town',
        degree: 'BSc',
        field: 'Statistics',
        startDate: '2016-02-01',
        endDate: '2019-12-01',
      },
    ],
    projects: [],
  },
  'david.eshete': {
    patch: {
      headline: 'Site reliability engineer: Kubernetes, Terraform, calm on-call',
      summary: 'Nine years running production. Likes runbooks, hates heroics.',
      targetRoles: ['Site Reliability Engineer', 'Platform Engineer'],
      targetLocations: ['Remote', 'Addis Ababa'],
      salaryMin: 95000,
      salaryMax: 140000,
      workAuthStatus: 'CITIZEN',
      remotePref: 'FLEXIBLE',
      relocationOk: false,
    },
    skills: [
      skill('kubernetes', 'DEVOPS', 'EXPERT', 6),
      skill('terraform', 'DEVOPS', 'EXPERT', 6),
      skill('aws', 'DEVOPS', 'EXPERT', 8),
      skill('linux', 'DEVOPS', 'EXPERT', 9),
      skill('go', 'BACKEND', 'ADVANCED', 4),
      skill('prometheus', 'DEVOPS', 'ADVANCED', 5),
      skill('docker', 'DEVOPS', 'EXPERT', 8),
    ],
    experience: [
      {
        companyName: 'Woodgrove Bank',
        title: 'Senior Site Reliability Engineer',
        startDate: '2019-05-01',
        description:
          'Ran a 40-service Kubernetes platform at 99.98% availability; wrote the incident process.',
        technologies: ['kubernetes', 'terraform', 'aws', 'prometheus'],
      },
      {
        companyName: 'Litware Security',
        title: 'Systems Engineer',
        startDate: '2015-04-01',
        endDate: '2019-04-30',
        description: 'Linux fleet, CI and the first move to containers.',
        technologies: ['linux', 'docker'],
      },
    ],
    education: [],
    projects: [],
  },
};

const job = (companyName, title, o) => ({ companyName, title, ...o });

/** The job market of the demo: strong fits, near misses, hard-filter blockers and noise, for four different people. */
export const JOBS = [
  // Backend: Ana's world
  job('Northwind Cloud', 'Senior Backend Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 100000,
    salaryMax: 130000,
    requiredSkills: ['typescript', 'node', 'postgresql'],
    preferredSkills: ['aws', 'docker'],
    visaSponsorship: false,
    description: 'Own the billing API for a cloud platform. Small team, strong on-call practice.',
  }),
  job('Contoso Labs', 'Staff Backend Engineer', {
    remoteType: 'REMOTE',
    seniority: 'STAFF',
    salaryMin: 120000,
    salaryMax: 150000,
    requiredSkills: ['typescript', 'node', 'postgresql', 'aws'],
    preferredSkills: ['graphql'],
    description: 'Technical direction for the platform team.',
  }),
  job('Fabrikam Payments', 'Backend Engineer, Ledger', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 90000,
    salaryMax: 120000,
    requiredSkills: ['node', 'postgresql', 'typescript'],
    preferredSkills: ['redis'],
    description: 'Double-entry ledger service; correctness over speed.',
  }),
  job('Tailspin Logistics', 'Backend Engineer, Tracking', {
    remoteType: 'HYBRID',
    location: 'Remote',
    seniority: 'MID',
    salaryMin: 80000,
    salaryMax: 105000,
    requiredSkills: ['node', 'typescript'],
    preferredSkills: ['aws', 'docker'],
    description: 'Shipment events at scale.',
  }),
  job('Wingtip Commerce', 'Principal Engineer', {
    remoteType: 'REMOTE',
    seniority: 'PRINCIPAL',
    salaryMin: 150000,
    salaryMax: 185000,
    requiredSkills: ['typescript', 'postgresql', 'aws', 'kubernetes', 'go'],
    description: 'Architecture across checkout and fulfilment.',
  }),
  job('Proseware', 'Junior Node Developer', {
    remoteType: 'REMOTE',
    seniority: 'ENTRY',
    salaryMin: 35000,
    salaryMax: 48000,
    requiredSkills: ['node'],
    description: 'First role; mentoring provided.',
  }),
  job('Lucerne Health', 'Backend Engineer (on-site)', {
    remoteType: 'ONSITE',
    location: 'Reykjavik',
    seniority: 'SENIOR',
    salaryMin: 95000,
    salaryMax: 115000,
    requiredSkills: ['typescript', 'node', 'postgresql'],
    description: 'Clinic systems; the team works from the office.',
  }),
  // Frontend: Ben's world
  job('Fabrikam Payments', 'Senior Frontend Engineer', {
    remoteType: 'HYBRID',
    location: 'London',
    seniority: 'SENIOR',
    salaryMin: 75000,
    salaryMax: 95000,
    requiredSkills: ['react', 'typescript', 'css'],
    preferredSkills: ['accessibility'],
    visaSponsorship: true,
    description: 'Checkout and onboarding interfaces. Visa sponsorship available.',
  }),
  job('Contoso Labs', 'Frontend Engineer', {
    remoteType: 'REMOTE',
    seniority: 'MID',
    salaryMin: 65000,
    salaryMax: 85000,
    requiredSkills: ['react', 'typescript', 'next.js'],
    preferredSkills: ['graphql'],
    visaSponsorship: false,
    description: 'Product UI for a developer tool. Remote, no sponsorship.',
  }),
  job('Adatum Analytics', 'Design Systems Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 80000,
    salaryMax: 100000,
    requiredSkills: ['react', 'css', 'accessibility', 'typescript'],
    visaSponsorship: true,
    description: 'Own the component library and its accessibility audit.',
  }),
  job('Wingtip Commerce', 'Full-stack Engineer', {
    remoteType: 'HYBRID',
    location: 'London',
    seniority: 'MID',
    salaryMin: 70000,
    salaryMax: 90000,
    requiredSkills: ['react', 'node', 'typescript'],
    preferredSkills: ['graphql'],
    visaSponsorship: true,
    description: 'Storefront and admin tooling.',
  }),
  job('Woodgrove Bank', 'Frontend Engineer, Mobile Web', {
    remoteType: 'ONSITE',
    location: 'Frankfurt',
    seniority: 'MID',
    salaryMin: 65000,
    salaryMax: 80000,
    requiredSkills: ['react', 'typescript'],
    visaSponsorship: false,
    description: 'Office-based role; no sponsorship.',
  }),
  // Data: Chloe's world
  job('Adatum Analytics', 'Data Engineer', {
    remoteType: 'REMOTE',
    seniority: 'MID',
    salaryMin: 65000,
    salaryMax: 85000,
    requiredSkills: ['sql', 'python', 'dbt'],
    preferredSkills: ['airflow'],
    description: 'Warehouse modelling and orchestration.',
  }),
  job('Lucerne Health', 'Analytics Engineer', {
    remoteType: 'HYBRID',
    location: 'Johannesburg',
    seniority: 'MID',
    salaryMin: 55000,
    salaryMax: 75000,
    requiredSkills: ['sql', 'dbt'],
    preferredSkills: ['python'],
    description: 'Clinical outcomes dashboards.',
  }),
  job('Northwind Cloud', 'Senior Data Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 95000,
    salaryMax: 120000,
    requiredSkills: ['sql', 'python', 'spark', 'airflow', 'dbt'],
    description: 'Usage and billing data platform.',
  }),
  job('Tailspin Logistics', 'Data Analyst', {
    remoteType: 'REMOTE',
    seniority: 'ENTRY',
    salaryMin: 38000,
    salaryMax: 50000,
    requiredSkills: ['sql'],
    preferredSkills: ['python'],
    description: 'Reporting for the operations team.',
  }),
  job('Proseware', 'Machine Learning Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 110000,
    salaryMax: 140000,
    requiredSkills: ['python', 'pytorch', 'sql', 'spark', 'kubernetes'],
    description: 'Ranking models in production.',
  }),
  // Operations: David's world
  job('Woodgrove Bank', 'Site Reliability Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 105000,
    salaryMax: 135000,
    requiredSkills: ['kubernetes', 'terraform', 'aws', 'linux'],
    preferredSkills: ['prometheus', 'go'],
    description: 'Platform reliability for a retail bank.',
  }),
  job('Northwind Cloud', 'Platform Engineer', {
    remoteType: 'REMOTE',
    seniority: 'SENIOR',
    salaryMin: 100000,
    salaryMax: 130000,
    requiredSkills: ['kubernetes', 'terraform', 'docker'],
    preferredSkills: ['aws', 'go'],
    description: 'Internal developer platform.',
  }),
  job('Litware Security', 'DevOps Engineer', {
    remoteType: 'HYBRID',
    location: 'Addis Ababa',
    seniority: 'MID',
    salaryMin: 90000,
    salaryMax: 115000,
    requiredSkills: ['linux', 'docker', 'aws'],
    preferredSkills: ['terraform'],
    description: 'Security tooling delivery pipeline.',
  }),
  job('Contoso Labs', 'Staff Site Reliability Engineer', {
    remoteType: 'REMOTE',
    seniority: 'STAFF',
    salaryMin: 130000,
    salaryMax: 160000,
    requiredSkills: ['kubernetes', 'terraform', 'aws', 'prometheus', 'go'],
    description: 'Reliability strategy across three product lines.',
  }),
  job('Wingtip Commerce', 'Build and Release Engineer', {
    remoteType: 'REMOTE',
    seniority: 'MID',
    salaryMin: 85000,
    salaryMax: 105000,
    requiredSkills: ['docker', 'linux'],
    preferredSkills: ['terraform'],
    description: 'CI speed and release safety.',
  }),
  // Noise: nobody here is a fit
  job('Lucerne Health', 'Office Manager', {
    remoteType: 'ONSITE',
    location: 'Reykjavik',
    salaryMin: 30000,
    salaryMax: 42000,
    requiredSkills: ['scheduling'],
    description: 'Front-of-house and supplies.',
  }),
  job('Proseware', 'Senior Accountant', {
    remoteType: 'ONSITE',
    location: 'Oslo',
    seniority: 'SENIOR',
    salaryMin: 60000,
    salaryMax: 75000,
    requiredSkills: ['accounting', 'excel'],
    description: 'Month-end close and audit support.',
  }),
  job('Tailspin Logistics', 'Warehouse Supervisor', {
    remoteType: 'ONSITE',
    location: 'Rotterdam',
    requiredSkills: ['logistics'],
    description: 'Night shift lead.',
  }),
];

/** Jobs that are no longer open (set after applications exist, the way a real posting ages). */
export const AGED_JOBS = [
  { title: 'Junior Node Developer', status: 'CLOSED' },
  { title: 'Data Analyst', status: 'EXPIRED' },
  { title: 'Build and Release Engineer', status: 'EXPIRED' },
];

const SHORT = ['SHORTLISTED'];
const DOC = [...SHORT, 'RESUME_GENERATED', 'COVER_LETTER_GENERATED'];
const READY = [...DOC, 'READY_TO_APPLY'];
const SENT = [...READY, 'APPROVE', 'APPLIED'];
const SCREEN = [...SENT, 'SCREENING'];
const INTERVIEW = [...SCREEN, 'INTERVIEW'];
const FINAL = [...INTERVIEW, 'FINAL_INTERVIEW'];

/** Where applications end up, by person: each list is applied to that person's best matches in order. `by` says who acts: the candidate or the recruiter. */
export const JOURNEYS = {
  'owner.demo': [
    { path: [...FINAL, 'OFFER', 'ACCEPTED'], label: 'accepted' },
    { path: [...FINAL, 'OFFER'], label: 'offer waiting' },
    { path: INTERVIEW, label: 'interviewing' },
    { path: SENT, label: 'sent' },
    { path: [...READY], label: 'waiting for approval' },
    { path: [...SHORT, 'RESUME_GENERATED', 'NEEDS_HUMAN_REVIEW'], label: 'stopped for review' },
    { path: [...SENT, 'NO_RESPONSE'], label: 'no response' },
    { path: SHORT, label: 'shortlisted' },
  ],
  'ana.bekele': [
    { path: [...FINAL, 'OFFER', 'ACCEPTED'], label: 'accepted' },
    { path: [...FINAL, 'OFFER'], label: 'offer waiting' },
    { path: INTERVIEW, label: 'interviewing', by: 'rita.recruiter' },
    { path: SENT, label: 'sent' },
    { path: [...READY], label: 'waiting for approval' },
    { path: [...SHORT, 'RESUME_GENERATED', 'NEEDS_HUMAN_REVIEW'], label: 'stopped for review' },
    { path: [...INTERVIEW, 'REJECTED'], label: 'rejected after interview' },
    { path: SHORT, label: 'shortlisted' },
  ],
  'ben.carter': [
    { path: SCREEN, label: 'in screening' },
    { path: [...SENT, 'NO_RESPONSE'], label: 'no response' },
    { path: [...READY, 'APPROVE'], label: 'approved, not yet sent' },
    { path: [...SHORT, 'WITHDRAWN'], label: 'withdrawn' },
    { path: ['REJECTED'], label: 'rejected early' },
  ],
  'chloe.dlamini': [
    { path: INTERVIEW, label: 'interviewing' },
    { path: DOC, label: 'documents ready' },
    { path: SENT, label: 'sent' },
    { path: ['EXPIRED'], label: 'expired unanswered' },
  ],
  'david.eshete': [
    { path: FINAL, label: 'final interview' },
    { path: [...SENT, 'REJECTED'], label: 'rejected' },
    { path: READY, label: 'waiting for approval' },
  ],
};

export const GLOBEX_JOBS = [
  job('Hooli Systems', 'Backend Engineer', {
    remoteType: 'REMOTE',
    seniority: 'MID',
    salaryMin: 70000,
    salaryMax: 90000,
    requiredSkills: ['java', 'postgresql'],
    description: 'A job in another workspace: nobody in Northwind can see it.',
  }),
  job('Initech', 'QA Engineer', {
    remoteType: 'HYBRID',
    location: 'Austin',
    seniority: 'MID',
    salaryMin: 60000,
    salaryMax: 80000,
    requiredSkills: ['testing'],
    description: 'Also private to Globex.',
  }),
];

export const SOURCES = [
  {
    type: 'GREENHOUSE',
    name: 'Northwind Cloud careers',
    config: { boardToken: 'northwindcloud', companyName: 'Northwind Cloud' },
    pollIntervalMinutes: 180,
  },
  {
    type: 'RSS',
    name: 'Remote jobs feed',
    config: { feedUrl: 'https://feeds.example.test/remote-jobs.xml', companyName: 'Various' },
    pollIntervalMinutes: 60,
  },
];
