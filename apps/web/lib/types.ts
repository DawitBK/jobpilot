/** Response shapes the web app reads. The API's OpenAPI document is the source of truth. */
export type RoleName = 'OWNER' | 'ADMIN' | 'RECRUITER' | 'CANDIDATE' | 'VIEWER' | string;

export interface Page<T> {
  items: T[];
  page: { limit: number; offset: number; total: number };
}

export interface Me {
  user: { id: string; email: string; fullName: string };
  organization: { id: string; name: string; slug: string; plan: string };
  role: RoleName;
  permissions: string[];
}

export interface Member {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: RoleName;
  status: 'ACTIVE' | 'REMOVED';
  joinedAt: string;
}

export interface Skill {
  id: string;
  skillName: string;
  category: string;
  proficiency: string;
  yearsExperience: number | null;
}
export interface Experience {
  id: string;
  companyName: string;
  title: string;
  startDate: string;
  endDate: string | null;
  description: string | null;
  technologies: string[];
}
export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string | null;
  startDate: string | null;
  endDate: string | null;
}
export interface Project {
  id: string;
  name: string;
  description: string | null;
  technologies: string[];
  url: string | null;
}
export interface Profile {
  id: string;
  userId: string;
  fullName: string;
  headline: string | null;
  summary: string | null;
  targetRoles: string[];
  targetLocations: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  workAuthStatus: string;
  remotePref: string;
  relocationOk: boolean;
  version: number;
  yearsExperience: number;
  skills: Skill[];
  experience: Experience[];
  education: Education[];
  projects: Project[];
}

export interface Job {
  id: string;
  companyId: string;
  companyName: string;
  sourceId: string | null;
  title: string;
  description: string;
  location: string | null;
  remoteType: 'REMOTE' | 'HYBRID' | 'ONSITE';
  salaryMin: number | null;
  salaryMax: number | null;
  seniority: string | null;
  employmentType: string;
  requiredSkills: string[];
  preferredSkills: string[];
  visaSponsorship: boolean | null;
  applicationUrl: string | null;
  postedAt: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CLOSED';
  version: number;
}

export interface Source {
  id: string;
  type: 'RSS' | 'GREENHOUSE';
  name: string;
  config: Record<string, string>;
  enabled: boolean;
  pollIntervalMinutes: number;
  lastRunAt: string | null;
  lastRunStatus: 'OK' | 'ERROR' | null;
  lastRunMessage: string | null;
  version: number;
}

export interface RunResult {
  fetched: number;
  created: number;
  duplicates: number;
  discarded: number;
  matched: number;
}

export interface Match {
  id: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  candidateProfileId: string;
  overallScore: number;
  technicalScore: number;
  locationScore: number;
  salaryScore: number;
  seniorityScore: number;
  missingSkills: string[];
  strongEvidence: string[];
  hardFilters: string[];
  recommendation: 'APPLY' | 'MAYBE' | 'SKIP';
  scoringVersion: string;
}

export interface Application {
  id: string;
  candidateProfileId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  state: string;
  stateEnteredAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  appliedAt: string | null;
  version: number;
}
export interface ApplicationEvent {
  fromState: string | null;
  toState: string;
  actorType: 'SYSTEM' | 'USER' | 'AI_AGENT' | 'BROWSER_WORKER';
  actorId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
}
export interface ApplicationDetail extends Application {
  allowedNext: string[];
  match: {
    overallScore: number;
    recommendation: 'APPLY' | 'MAYBE' | 'SKIP';
    missingSkills: string[];
  } | null;
  events: ApplicationEvent[];
}

export interface AuditEntry {
  id: number;
  actorUserId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
}

export interface OrganizationChoice {
  organizationSelectionRequired: true;
  selectionToken: string;
  organizations: { id: string; name: string; role: RoleName }[];
}
