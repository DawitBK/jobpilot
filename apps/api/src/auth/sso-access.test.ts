import { describe, expect, it } from 'vitest';
import { appRolesClaim, fullNameFrom, hasAccessFromIdp } from './sso-access.js';

describe('hasAccessFromIdp', () => {
  it('is true when the provider gave the member role, whatever else it gave', () => {
    expect(hasAccessFromIdp(['member'])).toBe(true);
    expect(hasAccessFromIdp([' Member ', 'wizard'])).toBe(true);
  });

  it('is false for no role or for roles that are not the member role, so there is no access', () => {
    expect(hasAccessFromIdp([])).toBe(false);
    expect(hasAccessFromIdp(['OWNER', 'ADMIN', 'recruiter'])).toBe(false);
  });
});

describe('fullNameFrom', () => {
  it("uses the provider's name, trimmed, and never leaves the name empty", () => {
    expect(fullNameFrom({ roles: [], fullName: ' Abebe Kebede ' }, 'a@b.test')).toBe(
      'Abebe Kebede',
    );
    expect(fullNameFrom({ roles: [] }, 'abebe.k@jobs.test')).toBe('abebe.k');
    expect(fullNameFrom({ roles: [], fullName: '   ' }, 'abebe@jobs.test')).toBe('abebe');
  });
});

describe('appRolesClaim', () => {
  it('is a list of text when the provider sent one, even an empty list (no access)', () => {
    expect(appRolesClaim(['member'])).toEqual(['member']);
    expect(appRolesClaim([])).toEqual([]);
    expect(appRolesClaim(['member', 3, null])).toEqual(['member']);
  });

  it('is undefined when the claim is absent or not a list: the provider does not manage this application', () => {
    expect(appRolesClaim(undefined)).toBeUndefined();
    expect(appRolesClaim('member')).toBeUndefined();
    expect(appRolesClaim(null)).toBeUndefined();
  });
});
