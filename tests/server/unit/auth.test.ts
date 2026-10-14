import { describe, expect, it } from 'vitest';
import {
  authenticate,
  clearedSessionCookie,
  createSession,
  hashInvitationToken,
  sessionCookie,
  signIn,
} from '../../../server/auth.ts';
import { config } from '../../../server/config.ts';
import { useSeededDatabase } from '../helpers/database.ts';
import { testPassword, users } from '../helpers/fixtures.ts';

describe('authentication primitives', () => {
  useSeededDatabase();

  it('hashes tokens with SHA-256 so the database never stores usable secrets', () => {
    expect(hashInvitationToken('token')).toBe(
      '3c469e9d6c5875d37a43f353d4f88e61fcf812c66eee3457465a40b0da4153e0',
    );
  });

  it('signIn returns the account and organization roles, or null', () => {
    const account = signIn(users.multiOrg.email, testPassword);
    expect(account).toMatchObject({ id: users.multiOrg.id, email: users.multiOrg.email });
    expect(account?.organizations.map((organization) => organization.role)).toEqual(['operator', 'admin']);
    expect(signIn(users.multiOrg.email, 'wrong')).toBeNull();
    expect(signIn(users.nsInactive.email, testPassword)).toBeNull();
    expect(signIn('  ' + users.multiOrg.email.toUpperCase() + ' ', testPassword)?.id).toBe(users.multiOrg.id);
  });

  it('createSession refuses deactivated or unknown accounts', () => {
    expect(() => createSession(users.nsInactive.id)).toThrow('User account is unavailable');
    expect(() => createSession('user-missing')).toThrow('User account is unavailable');
  });

  it('authenticate resolves cookies before bearer tokens and ignores invalid credentials', () => {
    expect(authenticate(undefined, undefined)).toBeNull();
    expect(authenticate('not-a-session', undefined)).toBeNull();
    expect(authenticate(undefined, `Bearer ${config.apiToken}`)?.serviceToken).toBe(true);
    expect(authenticate(undefined, `Bearer ${config.apiToken}x`)).toBeNull();
    expect(authenticate(undefined, `bearer ${config.apiToken}`)).toBeNull();

    const session = createSession(users.nsOwner.id);
    const principal = authenticate(session.token, `Bearer ${config.apiToken}`);
    expect(principal).toMatchObject({ id: users.nsOwner.id, sessionToken: session.token });
    expect(principal?.serviceToken).toBeUndefined();
  });

  it('session cookies are HttpOnly, strict, and scoped to the site; Secure is added in production only', () => {
    expect(sessionCookie('abc')).toBe(
      `remonet_session=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionLifetimeMs / 1000}`,
    );
    expect(clearedSessionCookie()).toBe('remonet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    expect(config.isProduction).toBe(false);
  });
});
