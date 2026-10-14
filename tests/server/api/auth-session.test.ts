import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashInvitationToken } from '../../../server/auth.ts';
import { config } from '../../../server/config.ts';
import { db } from '../../../server/persistence/database.ts';
import { allowedOrigin, expectError, useTestApp } from '../helpers/app.ts';
import { testPassword, users } from '../helpers/fixtures.ts';

type Session = {
  user: { id: string; email: string; displayName: string };
  organizations: { id: string; name: string; role: string }[];
};

// The login route allows 8 attempts per 15 minutes per client address, which covers everything this
// file needs. Rate limiting itself is covered in http-hardening.test.ts.
describe('login and session lifecycle', () => {
  const api = useTestApp();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues an HttpOnly session cookie and returns the account with its organization roles', async () => {
    const { response, client } = await api.login(users.multiOrg.email, testPassword);
    expect(response.status).toBe(200);
    const body = response.body as Session;
    expect(body.user).toEqual({
      id: users.multiOrg.id,
      email: users.multiOrg.email,
      displayName: users.multiOrg.displayName,
    });
    expect(body).not.toHaveProperty('passwordHash');
    expect(body.organizations).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'admin' },
    ]);

    const cookie = response.cookies.find((candidate) => candidate.name === 'remonet_session');
    expect(cookie).toBeDefined();
    expect(cookie!.value.length).toBeGreaterThanOrEqual(32);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie!.maxAge).toBe(config.sessionLifetimeMs / 1000);
    expect(response.headers['cache-control']).toBe('no-store');

    const me = await client.get<Session>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(users.multiOrg.id);
  });

  it('stores only a hash of the session token', async () => {
    const { token } = await api.login(users.nsViewer.email, testPassword);
    expect(token).toBeDefined();
    const byHash = db
      .prepare('SELECT user_id AS userId FROM sessions WHERE token_hash = ?')
      .get(hashInvitationToken(token!));
    expect(byHash).toEqual({ userId: users.nsViewer.id });
    expect(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(token!)).toBeUndefined();
  });

  it('rejects a wrong password with a generic message and no cookie', async () => {
    const { response } = await api.login(users.nsOwner.email, 'definitely-not-the-password');
    expectError(response, 401, 'Email or password is incorrect');
    expect(response.cookies).toHaveLength(0);
  });

  it('rejects an unknown account with the same generic message', async () => {
    const { response } = await api.login('nobody@northstar.test', testPassword);
    expectError(response, 401, 'Email or password is incorrect');
  });

  it('refuses to sign in a deactivated account even with the correct password', async () => {
    const { response } = await api.login(users.nsInactive.email, testPassword);
    expectError(response, 401, 'Email or password is incorrect');
  });

  it('treats the email address case-insensitively', async () => {
    const { response } = await api.login(users.nsOwner.email.toUpperCase(), testPassword);
    expect(response.status).toBe(200);
    expect((response.body as Session).user.id).toBe(users.nsOwner.id);
  });

  it('rejects unauthenticated, forged, and malformed session cookies', async () => {
    expectError(await api.anonymous.get('/api/auth/me'), 401, 'Unauthorized');
    expectError(await api.withSessionCookie('forged-token-value').get('/api/auth/me'), 401);
    expectError(await api.withSessionCookie('').get('/api/auth/me'), 401);
  });

  it('logout revokes the server-side session and clears the cookie', async () => {
    const { client, token } = await api.login(users.nsAdmin.email, testPassword);
    const logout = await client.post('/api/auth/logout', undefined, { headers: { origin: allowedOrigin } });
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });
    const cleared = logout.cookies.find((cookie) => cookie.name === 'remonet_session');
    expect(cleared).toMatchObject({ value: '', maxAge: 0, httpOnly: true, sameSite: 'Strict' });
    expect(
      db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hashInvitationToken(token!)),
    ).toBeUndefined();

    // Replaying the old cookie after logout must not work.
    expectError(await client.get('/api/auth/me'), 401);
  });

  it('logout is safe to call without a session', async () => {
    const response = await api.anonymous.post('/api/auth/logout');
    expect(response.status).toBe(200);
  });

  it('sessions expire after the configured lifetime', async () => {
    const client = api.as(users.nsOwner);
    expect((await client.get('/api/auth/me')).status).toBe(200);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + config.sessionLifetimeMs - 60_000);
    expect((await client.get('/api/auth/me')).status).toBe(200);

    vi.setSystemTime(Date.now() + 2 * 60_000);
    expectError(await client.get('/api/auth/me'), 401, 'Unauthorized');
  });

  it('sessions of a deactivated account stop working immediately', async () => {
    const client = api.as(users.nsOperator);
    expect((await client.get('/api/auth/me')).status).toBe(200);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(users.nsOperator.id);
    expectError(await client.get('/api/auth/me'), 401);
  });

  it('reflects membership changes on the next request without re-authenticating', async () => {
    const client = api.as(users.nsViewer);
    let me = await client.get<Session>('/api/auth/me');
    expect(me.body.organizations.map((org) => org.id)).toEqual(['org-demo']);

    db.prepare(
      "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, 'team-acme', 'viewer', ?)",
    ).run(users.nsViewer.id, new Date().toISOString());
    me = await client.get<Session>('/api/auth/me');
    expect(me.body.organizations.map((org) => org.id)).toEqual(['org-acme', 'org-demo']);

    db.prepare('DELETE FROM team_memberships WHERE user_id = ?').run(users.nsViewer.id);
    me = await client.get<Session>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.organizations).toEqual([]);
  });

  it('expired sessions are purged when a new session is created', async () => {
    const { token } = await api.login(users.soloOwner.email, testPassword);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      hashInvitationToken(token!),
    );
    api.as(users.nsOwner);
    expect(
      db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(hashInvitationToken(token!)),
    ).toBeUndefined();
  });

  it('identifies the integration token as a read-only service principal', async () => {
    const me = await api.asService().get<Session & { user: { id: string } }>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ id: 'service-token', email: '', displayName: 'API integration' });
    expect(me.body.organizations).toEqual([
      { id: 'org-demo', name: 'Northstar Engineering', role: 'viewer' },
    ]);
  });

  it('rejects bearer tokens that do not match the configured secret', async () => {
    const wrong = await api.anonymous.get('/api/auth/me', {
      headers: { authorization: `Bearer ${'x'.repeat(44)}` },
    });
    expectError(wrong, 401);
    const malformed = await api.anonymous.get('/api/auth/me', { headers: { authorization: 'Basic abc' } });
    expectError(malformed, 401);
  });
});
