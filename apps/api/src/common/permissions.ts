import type { RoleName } from '../db/schema.js';

/** Every permission is `resource:action`. A role is just a named set of them. */
export const PERMISSIONS = [
  'organizations:manage',
  'members:invite',
  'members:read',
  'candidates:read',
  'candidates:write',
  'jobs:read',
  'jobs:write',
  'sources:manage',
  'applications:read',
  'applications:write',
  'applications:approve',
  'ai_config:manage',
  'billing:manage',
  'analytics:read',
  'audit:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  'candidates:read',
  'jobs:read',
  'applications:read',
  'analytics:read',
];

/**
 * The platform role templates (seeded by migration 0002; a test keeps the two in step).
 * CANDIDATE holds the write permissions too, but the services restrict them to the candidate's own
 * records: the permission says what kind of thing, the service decides whose.
 */
export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  OWNER: [...PERMISSIONS],
  ADMIN: PERMISSIONS.filter((p) => p !== 'billing:manage'),
  RECRUITER: [
    'members:read',
    'candidates:read',
    'candidates:write',
    'jobs:read',
    'jobs:write',
    'sources:manage',
    'applications:read',
    'applications:write',
    'applications:approve',
    'analytics:read',
  ],
  HIRING_MANAGER: READ_ONLY,
  ANALYST: READ_ONLY,
  CANDIDATE: [
    'candidates:read',
    'candidates:write',
    'jobs:read',
    'applications:read',
    'applications:write',
    'applications:approve',
    'analytics:read',
  ],
};
