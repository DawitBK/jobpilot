import { z } from 'zod';
import { ROLE_NAMES } from '../db/schema.js';

export const idParamsSchema = z.object({ id: z.uuid() });

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
const fullName = z.string().trim().min(1).max(120);
/** Length matters more than composition rules (NIST 800-63B); the upper bound limits hashing cost. */
const password = z.string().min(12).max(128);

export const registerSchema = z.object({ email, password, fullName }).strict();
export type Register = z.output<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export type Login = z.output<typeof loginSchema>;

export const selectOrganizationSchema = z
  .object({ selectionToken: z.string().min(20).max(2000), organizationId: z.uuid() })
  .strict();
export type SelectOrganization = z.output<typeof selectOrganizationSchema>;

export const oidcExchangeSchema = z
  .object({
    code: z.string().min(1).max(2048),
    codeVerifier: z.string().min(43).max(128),
    nonce: z.string().min(8).max(200),
    redirectUri: z.url().max(2048),
  })
  .strict();
export type OidcExchange = z.output<typeof oidcExchangeSchema>;

/** The body of the identity provider's back-channel logout call (form encoded): one signed logout token. */
export const backchannelLogoutSchema = z
  .object({ logout_token: z.string().min(20).max(8192) })
  .strict();
export type BackchannelLogout = z.output<typeof backchannelLogoutSchema>;

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) }).strict();
export type RefreshRequest = z.output<typeof refreshSchema>;

export const userSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
});

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: userSchema,
  organization: z.object({ id: z.uuid(), name: z.string(), role: z.enum(ROLE_NAMES) }),
});
export type TokenPair = z.output<typeof tokenPairSchema>;

/** The answer when a person belongs to several organizations: choose one with the selection token. */
export const organizationChoiceSchema = z.object({
  organizationSelectionRequired: z.literal(true),
  selectionToken: z.string(),
  organizations: z.array(z.object({ id: z.uuid(), name: z.string(), role: z.enum(ROLE_NAMES) })),
});
export type OrganizationChoice = z.output<typeof organizationChoiceSchema>;

export const meSchema = z.object({
  user: userSchema,
  organization: z.object({ id: z.uuid(), name: z.string(), slug: z.string(), plan: z.string() }),
  role: z.enum(ROLE_NAMES),
  permissions: z.array(z.string()),
});

export const memberSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(ROLE_NAMES),
  status: z.enum(['ACTIVE', 'REMOVED']),
  joinedAt: z.iso.datetime(),
});
export type MemberDto = z.output<typeof memberSchema>;

/** The owner role is held by the person who created the organization; it is not handed out here. */
const assignableRole = z
  .enum(ROLE_NAMES)
  .refine((r) => r !== 'OWNER', 'The owner role cannot be assigned');

export const addMemberSchema = z.object({ email, role: assignableRole }).strict();
export type AddMember = z.output<typeof addMemberSchema>;

export const updateMemberSchema = z
  .object({ role: assignableRole.optional(), status: z.enum(['ACTIVE', 'REMOVED']).optional() })
  .strict()
  .refine((v) => v.role !== undefined || v.status !== undefined, {
    message: 'Provide a role or a status',
  });
export type UpdateMember = z.output<typeof updateMemberSchema>;

export const updateOrganizationSchema = z
  .object({ name: z.string().trim().min(1).max(120) })
  .strict();
export type UpdateOrganization = z.output<typeof updateOrganizationSchema>;
