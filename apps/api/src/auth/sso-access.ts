/**
 * What the identity provider says about this person for THIS application: the roles it gave them here (its `app_roles` claim) and who they are.
 * The claim is present only when the provider manages this application's access from its console; an empty list then means "no access".
 *
 * JobPilot's own roles (owner, admin, recruiter, ...) belong to organizations and are managed inside each one. What the provider decides is
 * whether a person may use JobPilot at all: the role `member`, which lets them sign in to their own workspace.
 */
export interface SsoAccess {
  roles: string[];
  fullName?: string;
}

/** The only role the provider can give for JobPilot. */
export const IDP_ACCESS_ROLE = 'member';

/** Did the provider give this person a role that lets them in? */
export function hasAccessFromIdp(roles: readonly string[]): boolean {
  return roles.some((r) => r.trim().toLowerCase() === IDP_ACCESS_ROLE);
}

/** The name for a new account: the provider's, or the address before the @ when it sent none. Never empty. */
export function fullNameFrom(access: SsoAccess, email: string): string {
  return access.fullName?.trim() || email.split('@')[0] || email;
}

/** Read the `app_roles` claim: a list of text, or undefined when the claim is absent or not a list (the provider does not manage this application). */
export function appRolesClaim(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
}
