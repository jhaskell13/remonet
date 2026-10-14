import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashInvitationToken } from '../../../server/auth.ts';
import { db } from '../../../server/persistence/database.ts';
import { verifyPassword } from '../../../server/passwords.ts';
import { allowedOrigin, expectError, useTestApp, type ApiClient } from '../helpers/app.ts';
import { fixtures, testPassword, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type InviteResponse = { email: string; expiresAt: string; inviteUrl: string };
type Session = {
  user: { id: string; email: string; displayName: string };
  organizations: { id: string; role: string }[];
};

function tokenFrom(invite: InviteResponse) {
  return new URL(invite.inviteUrl).hash.replace('#invite=', '');
}

async function invite(
  client: ApiClient,
  email: string,
  role: 'admin' | 'operator' | 'viewer',
  teamId: string = demo.teamId,
) {
  const response = await client.post<InviteResponse>('/api/invitations', {
    email,
    organizationId: demo.organizationId,
    teamId,
    role,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return { ...response.body, token: tokenFrom(response.body) };
}

describe('invitations and membership lifecycle', () => {
  const api = useTestApp();

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a seven-day invitation and stores only the token hash', async () => {
    const created = await invite(api.as(users.nsOwner), 'New.Engineer@Northstar.test', 'viewer');
    expect(created.email).toBe('new.engineer@northstar.test');
    expect(created.inviteUrl.startsWith(`${allowedOrigin}/#invite=`)).toBe(true);
    expect(created.token.length).toBeGreaterThanOrEqual(32);
    const expiresIn = new Date(created.expiresAt).getTime() - Date.now();
    expect(expiresIn).toBeGreaterThan(7 * 24 * 60 * 60 * 1000 - 60_000);
    expect(expiresIn).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    const row = db
      .prepare(
        'SELECT token_hash AS tokenHash, invited_by AS invitedBy, accepted_at AS acceptedAt FROM invitations',
      )
      .get() as {
      tokenHash: string;
      invitedBy: string;
      acceptedAt: string | null;
    };
    expect(row.tokenHash).toBe(hashInvitationToken(created.token));
    expect(row.tokenHash).not.toBe(created.token);
    expect(row.invitedBy).toBe(users.nsOwner.id);
    expect(row.acceptedAt).toBeNull();
  });

  it('inspect reveals the organization, team, and role without requiring a session', async () => {
    const created = await invite(api.as(users.nsAdmin), 'invitee@northstar.test', 'operator');
    const inspected = await api.anonymous.post<{ data: Record<string, unknown> }>(
      '/api/invitations/inspect',
      { token: created.token },
    );
    expect(inspected.status).toBe(200);
    expect(inspected.body.data).toEqual({
      id: expect.any(String),
      email: 'invitee@northstar.test',
      organizationId: demo.organizationId,
      organizationName: 'Northstar Engineering',
      teamId: demo.teamId,
      teamName: 'Network Operations',
      role: 'operator',
      expiresAt: created.expiresAt,
      accountExists: false,
    });
    expect(inspected.body.data).not.toHaveProperty('tokenHash');
  });

  it('inspect rejects unknown tokens', async () => {
    expectError(
      await api.anonymous.post('/api/invitations/inspect', { token: 'nope' }),
      404,
      'Invitation is invalid or expired',
    );
  });

  it('a new engineer registers through the invitation and is signed in', async () => {
    const created = await invite(api.as(users.nsOwner), 'fresh@northstar.test', 'operator');
    const accepted = await api.anonymous.post<Session>(
      '/api/invitations/accept',
      { token: created.token, displayName: '  Fresh Engineer ', password: 'FreshPassword2026!' },
      { headers: { origin: allowedOrigin } },
    );
    expect(accepted.status).toBe(200);
    expect(accepted.body.user).toEqual({
      id: expect.any(String),
      email: 'fresh@northstar.test',
      displayName: 'Fresh Engineer',
    });
    expect(accepted.body.organizations).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'operator' },
    ]);
    const cookie = accepted.cookies.find((candidate) => candidate.name === 'remonet_session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });

    const me = await api.withSessionCookie(cookie!.value).get<Session>('/api/auth/me');
    expect(me.body.user.email).toBe('fresh@northstar.test');

    const stored = db
      .prepare('SELECT password_hash AS passwordHash FROM users WHERE email = ?')
      .get('fresh@northstar.test') as { passwordHash: string };
    expect(stored.passwordHash.startsWith('scrypt$')).toBe(true);
    expect(verifyPassword('FreshPassword2026!', stored.passwordHash)).toBe(true);
    expect(db.prepare('SELECT accepted_at AS acceptedAt FROM invitations').get()).toEqual({
      acceptedAt: expect.any(String),
    });
  });

  it('registration requires a display name and a password of at least 12 characters', async () => {
    const created = await invite(api.as(users.nsOwner), 'weak@northstar.test', 'viewer');
    for (const payload of [
      { token: created.token, displayName: 'Weak', password: 'short' },
      { token: created.token, displayName: '   ', password: 'LongEnoughPassword!' },
      { token: created.token, password: 'LongEnoughPassword!' },
      { token: created.token, displayName: 'Weak' },
    ]) {
      expectError(
        await api.anonymous.post('/api/invitations/accept', payload),
        400,
        'Choose a display name and a password of at least 12 characters',
      );
    }
    expect(db.prepare('SELECT 1 FROM users WHERE email = ?').get('weak@northstar.test')).toBeUndefined();
    expect(db.prepare('SELECT accepted_at AS acceptedAt FROM invitations').get()).toEqual({
      acceptedAt: null,
    });
  });

  it('an existing engineer must sign in with the invited address to join', async () => {
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'operator');
    // Anonymous registration is refused because the account exists.
    expectError(
      await api.anonymous.post('/api/invitations/accept', {
        token: created.token,
        displayName: 'Dup',
        password: 'LongEnoughPassword!',
      }),
      409,
      'This email already has an account. Sign in to accept the invitation.',
    );
    // A different signed-in account cannot hijack the invitation.
    expectError(
      await api.as(users.soloOwner).post('/api/invitations/accept', { token: created.token }),
      403,
      'Sign in with the invited email address to accept this invitation',
    );
    expect(
      db
        .prepare('SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?')
        .get(demo.teamId, users.soloOwner.id),
    ).toBeUndefined();

    // The invited account joins and gains the organization without a new session cookie.
    const accepted = await api
      .as(users.acmeViewer)
      .post<Session>('/api/invitations/accept', { token: created.token });
    expect(accepted.status).toBe(200);
    expect(accepted.cookies).toHaveLength(0);
    expect(accepted.body.organizations).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'viewer' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'operator' },
    ]);
  });

  it('invitations are single use', async () => {
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'viewer');
    expect(
      (await api.as(users.acmeViewer).post('/api/invitations/accept', { token: created.token })).status,
    ).toBe(200);
    expectError(
      await api.as(users.acmeViewer).post('/api/invitations/accept', { token: created.token }),
      404,
    );
    expectError(await api.anonymous.post('/api/invitations/inspect', { token: created.token }), 404);
  });

  it('invitations expire after seven days', async () => {
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'viewer');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(created.expiresAt).getTime() + 1000);
    expectError(
      await api.anonymous.post('/api/invitations/inspect', { token: created.token }),
      404,
      'Invitation is invalid or expired',
    );
    expectError(
      await api.as(users.acmeViewer).post('/api/invitations/accept', { token: created.token }),
      404,
    );
    expect(
      db
        .prepare('SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?')
        .get(demo.teamId, users.acmeViewer.id),
    ).toBeUndefined();
  });

  it('accepting grants exactly the invited role in the invited team', async () => {
    const created = await invite(api.as(users.nsOwner), users.soloOwner.email, 'viewer', demo.secondTeamId);
    await api.as(users.soloOwner).post('/api/invitations/accept', { token: created.token });
    expect(
      db
        .prepare('SELECT team_id AS teamId, role FROM team_memberships WHERE user_id = ? ORDER BY team_id')
        .all(users.soloOwner.id),
    ).toEqual([
      { teamId: demo.secondTeamId, role: 'viewer' },
      { teamId: 'team-solo', role: 'owner' },
    ]);
  });

  it('refuses to invite someone who is already a member of that team', async () => {
    // Roles of existing members are changed through membership management, not by re-inviting.
    const response = await api.as(users.nsOwner).post('/api/invitations', {
      email: users.nsViewer.email.toUpperCase(),
      organizationId: demo.organizationId,
      teamId: demo.teamId,
      role: 'admin',
    });
    expectError(response, 409, 'This person is already a member of the team');
    expect(db.prepare('SELECT COUNT(*) AS count FROM invitations').get()).toEqual({ count: 0 });
    // The same person can still be invited into another team of the organization.
    await invite(api.as(users.nsOwner), users.nsViewer.email, 'operator', demo.secondTeamId);
  });

  it('accepting an invitation never lowers or raises an existing membership in that team', async () => {
    // If the person joined the team between the invitation and its acceptance, the existing
    // membership wins and the invitation is simply consumed.
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'admin');
    db.prepare(
      "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
    ).run(users.acmeViewer.id, demo.teamId, new Date().toISOString());
    const accepted = await api
      .as(users.acmeViewer)
      .post<Session>('/api/invitations/accept', { token: created.token });
    expect(accepted.status).toBe(200);
    expect(
      db
        .prepare('SELECT role FROM team_memberships WHERE user_id = ? AND team_id = ?')
        .get(users.acmeViewer.id, demo.teamId),
    ).toEqual({ role: 'viewer' });
    expect(
      accepted.body.organizations.find((organization) => organization.id === demo.organizationId)?.role,
    ).toBe('viewer');
  });

  it('a deactivated account cannot accept an invitation', async () => {
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'viewer');
    const client = api.as(users.acmeViewer);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(users.acmeViewer.id);
    // The session is refused outright, which is the anonymous path; the account exists so registration is refused too.
    expectError(
      await client.post('/api/invitations/accept', {
        token: created.token,
        displayName: 'X',
        password: 'LongEnoughPassword!',
      }),
      409,
    );
    expect(
      db
        .prepare('SELECT 1 FROM team_memberships WHERE team_id = ? AND user_id = ?')
        .get(demo.teamId, users.acmeViewer.id),
    ).toBeUndefined();
  });

  it('the integration token can neither create nor accept invitations', async () => {
    const service = api.asService();
    expectError(
      await service.post('/api/invitations', {
        email: 'x@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'viewer',
      }),
      401,
      'Sign in with an engineer account',
    );
    const created = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'viewer');
    expectError(
      await service.post('/api/invitations/accept', { token: created.token }),
      403,
      'Sign in with an engineer account to accept this invitation',
    );
  });

  it('admins can invite operators and viewers but only owners can invite admins', async () => {
    const admin = api.as(users.nsAdmin);
    await invite(admin, 'op@northstar.test', 'operator');
    await invite(admin, 'view@northstar.test', 'viewer');
    expectError(
      await admin.post('/api/invitations', {
        email: 'adm@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'admin',
      }),
      403,
      'Only an organization owner can invite another admin',
    );
    await invite(api.as(users.nsOwner), 'adm@northstar.test', 'admin');
  });

  it('invitations are bound to a team of the stated organization', async () => {
    expectError(
      await api.as(users.nsOwner).post('/api/invitations', {
        email: 'x@northstar.test',
        organizationId: demo.organizationId,
        teamId: acme.teamId,
        role: 'viewer',
      }),
      400,
      'Team does not belong to this organization',
    );
    expectError(
      await api.as(users.acmeOwner).post('/api/invitations', {
        email: 'x@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'viewer',
      }),
      403,
      'Organization access denied',
    );
  });

  it('login still works for accounts created through invitations', async () => {
    const created = await invite(api.as(users.nsOwner), 'login-check@northstar.test', 'viewer');
    await api.anonymous.post('/api/invitations/accept', {
      token: created.token,
      displayName: 'Login Check',
      password: 'FreshPassword2026!',
    });
    const { response } = await api.login('login-check@northstar.test', 'FreshPassword2026!');
    expect(response.status).toBe(200);
    const { response: wrong } = await api.login('login-check@northstar.test', testPassword);
    expect(wrong.status).toBe(401);
  });
});
