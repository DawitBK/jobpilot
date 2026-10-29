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

export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  emailStatus: 'NOT_SENT' | 'SENT' | 'FAILED' | 'SKIPPED';
  createdAt: string;
}

export interface QuotaLine {
  resource: 'members' | 'sources' | 'applications' | 'aiGenerations';
  label: string;
  used: number;
  limit: number | null;
}
export interface PlanSpec {
  name: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE';
  label: string;
  priceUsdPerMonth: number | null;
  limits: Record<QuotaLine['resource'], number | null>;
}
export interface Billing {
  plan: PlanSpec['name'];
  quotas: QuotaLine[];
  plans: PlanSpec[];
  payment: { connected: boolean; note: string };
}

export interface MfaStatus {
  available: boolean;
  enabled: boolean;
  recoveryCodesLeft: number;
}

export interface Review {
  tier: 'LOW' | 'MEDIUM' | 'HIGH';
  reasons: { tier: 'LOW' | 'MEDIUM' | 'HIGH'; text: string }[];
  requiresAcknowledgement: boolean;
  autoSubmitAllowed: false;
  autoSubmitNote: string;
}

export interface CheckedClaim {
  text: string;
  verdict: 'SUPPORTED' | 'UNSUPPORTED' | 'CONFLICTING' | 'UNKNOWN';
  detail: string;
  evidenceFactIds: string[];
}
export interface DocumentItem {
  id: string;
  kind: 'RESUME' | 'COVER_LETTER';
  version: number;
  content: string;
  claims: CheckedClaim[];
  verdicts: Record<string, number>;
  provider: string;
  model: string;
  redactions: number;
  needsReview: boolean;
  createdAt: string;
}
export interface DocumentsResponse {
  latest: DocumentItem[];
  history: { id: string; kind: string; version: number; provider: string; createdAt: string }[];
  ai: {
    available: boolean;
    source: 'organization' | 'server' | null;
    vendor: string | null;
    model: string | null;
  };
}

export interface EmailItem {
  id: string;
  fromAddress: string;
  subject: string;
  body: string;
  receivedAt: string;
  classification: string;
  confidence: number;
  signals: string[];
  suggestedState: string | null;
  status: 'NEW' | 'ACTED' | 'DISMISSED';
  decidedAt: string | null;
}

export interface PolicySettings {
  minScoreForApproval: number;
  salaryGapPercent: number;
  maxMissingSkills: number;
}
export interface AiConnectionView {
  configured: boolean;
  source: 'organization' | 'server' | null;
  vendor: 'groq' | 'openai' | 'anthropic' | 'custom' | null;
  model: string | null;
  baseUrl: string | null;
  hint: string | null;
}
