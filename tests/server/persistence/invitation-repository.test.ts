import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acceptInvitation,
  createInvitation,
  inspectInvitation,
  listPendingInvitations,
  revokeInvitation,
} from '../../../server/persistence/repositories/invitation-repository.ts';
import { count, sqliteErrorCode, useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const week = 7 * 24 * 60 * 60 * 1000;

function invite(overrides: Partial<Parameters<typeof createInvitation>[0]> = {}) {
  const invitation = {
    id: `inv-${Math.random().toString(36).slice(2)}`,
    email: 'Newcomer@Northstar.test',
    organizationId: demo.organizationId,
    teamId: demo.teamId,
    role: 'viewer' as const,
    tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
    invitedBy: users.nsOwner.id,
    expiresAt: new Date(Date.now() + week).toISOString(),
    ...overrides,
  };
  createInvitation(invitation);
  return invitation;
}
const errorCode = (fn: () => unknown) => sqliteErrorCode(fn);

describe('invitation repository', () => {
  const db = useSeededDatabase();
  afterEach(() => vi.useRealTimers());

  it('stores emails lower-cased and inspects by token hash only while pending and unexpired', () => {
    const invitation = invite();
    expect(db.prepare('SELECT email FROM invitations WHERE id = ?').get(invitation.id)).toEqual({
      email: 'newcomer@northstar.test',
    });
    expect(inspectInvitation(invitation.tokenHash)).toMatchObject({
      id: invitation.id,
      email: 'newcomer@northstar.test',
      organizationName: 'Northstar Engineering',
      teamName: 'Network Operations',
      role: 'viewer',
      accountExists: false,
    });
    expect(inspectInvitation('unknown-hash')).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(invitation.expiresAt).getTime() + 1);
    expect(inspectInvitation(invitation.tokenHash)).toBeNull();
  });

  it('reports whether the invited address already has an account', () => {
    expect(
      inspectInvitation(invite({ email: users.acmeViewer.email.toUpperCase() }).tokenHash)?.accountExists,
    ).toBe(true);
  });

  it('accepting with an existing account creates the membership once and consumes the invitation', () => {
    const invitation = invite({ email: users.acmeViewer.email, role: 'operator' });
    const result = acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: users.acmeViewer.id });
    expect(result).toEqual({
      userId: users.acmeViewer.id,
      teamId: demo.teamId,
      role: 'operator',
      membershipCreated: true,
    });
    expect(
      db.prepare('SELECT accepted_at AS acceptedAt FROM invitations WHERE id = ?').get(invitation.id),
    ).toEqual({ acceptedAt: expect.any(String) });
    expect(
      errorCode(() =>
        acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: users.acmeViewer.id }),
      ),
    ).toBe('INVITATION_INVALID');
  });

  it('accepting with a new account creates the user atomically with the membership', () => {
    const invitation = invite({ email: 'fresh@northstar.test' });
    const user = {
      id: 'user-fresh',
      email: 'Fresh@Northstar.test',
      displayName: 'Fresh',
      passwordHash: 'scrypt$x',
    };
    expect(acceptInvitation({ tokenHash: invitation.tokenHash, user })).toMatchObject({
      userId: 'user-fresh',
      membershipCreated: true,
    });
    expect(db.prepare("SELECT email FROM users WHERE id = 'user-fresh'").get()).toEqual({
      email: 'fresh@northstar.test',
    });
    expect(count('team_memberships', "WHERE user_id = 'user-fresh'")).toBe(1);
  });

  it('reports an existing membership instead of changing it', () => {
    const invitation = invite({ email: users.nsViewer.email, role: 'admin' });
    expect(
      acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: users.nsViewer.id }),
    ).toMatchObject({ membershipCreated: false });
    expect(
      db
        .prepare('SELECT role FROM team_memberships WHERE user_id = ? AND team_id = ?')
        .get(users.nsViewer.id, demo.teamId),
    ).toEqual({ role: 'viewer' });
  });

  it('refuses mismatched, deactivated, and duplicate accounts without partial writes', () => {
    const invitation = invite({ email: users.acmeViewer.email });
    const before = { users: count('users'), memberships: count('team_memberships') };
    expect(
      errorCode(() => acceptInvitation({ tokenHash: 'unknown', existingUserId: users.acmeViewer.id })),
    ).toBe('INVITATION_INVALID');
    expect(
      errorCode(() =>
        acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: users.soloOwner.id }),
      ),
    ).toBe('INVITATION_EMAIL_MISMATCH');
    expect(
      errorCode(() => acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: 'user-missing' })),
    ).toBe('INVITATION_EMAIL_MISMATCH');
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(users.acmeViewer.id);
    expect(
      errorCode(() =>
        acceptInvitation({ tokenHash: invitation.tokenHash, existingUserId: users.acmeViewer.id }),
      ),
    ).toBe('INVITATION_EMAIL_MISMATCH');
    expect(errorCode(() => acceptInvitation({ tokenHash: invitation.tokenHash }))).toBe(
      'INVITATION_EMAIL_MISMATCH',
    );
    expect(
      errorCode(() =>
        acceptInvitation({
          tokenHash: invitation.tokenHash,
          user: { id: 'u', email: 'other@acme.test', displayName: 'O', passwordHash: 'h' },
        }),
      ),
    ).toBe('INVITATION_EMAIL_MISMATCH');
    expect(
      errorCode(() =>
        acceptInvitation({
          tokenHash: invitation.tokenHash,
          user: { id: 'u', email: users.acmeViewer.email, displayName: 'Dup', passwordHash: 'h' },
        }),
      ),
    ).toBe('ACCOUNT_EXISTS');
    expect({ users: count('users'), memberships: count('team_memberships') }).toEqual(before);
    expect(
      db.prepare('SELECT accepted_at AS acceptedAt FROM invitations WHERE id = ?').get(invitation.id),
    ).toEqual({ acceptedAt: null });
  });

  it('lists only pending, unexpired invitations of one organization, newest first', () => {
    const old = invite({ email: 'old@northstar.test' });
    db.prepare('UPDATE invitations SET created_at = ? WHERE id = ?').run(
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      old.id,
    );
    const recent = invite({ email: 'recent@northstar.test', role: 'admin' });
    const expired = invite({
      email: 'expired@northstar.test',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const accepted = invite({ email: users.acmeViewer.email });
    acceptInvitation({ tokenHash: accepted.tokenHash, existingUserId: users.acmeViewer.id });
    invite({
      email: 'other@acme.test',
      organizationId: acme.organizationId,
      teamId: acme.teamId,
      invitedBy: users.acmeOwner.id,
    });

    const pending = listPendingInvitations(demo.organizationId);
    expect(pending.map((invitation) => invitation.email)).toEqual([
      'recent@northstar.test',
      'old@northstar.test',
    ]);
    expect(pending[0]).toEqual({
      id: recent.id,
      email: 'recent@northstar.test',
      organizationId: demo.organizationId,
      teamId: demo.teamId,
      teamName: 'Network Operations',
      role: 'admin',
      invitedBy: { id: users.nsOwner.id, displayName: users.nsOwner.displayName },
      createdAt: expect.any(String),
      expiresAt: recent.expiresAt,
    });
    expect(pending.some((invitation) => invitation.id === expired.id)).toBe(false);
    expect(listPendingInvitations('org-missing')).toEqual([]);
  });

  it('revokes pending invitations only, scoped to the organization', () => {
    const invitation = invite();
    expect(revokeInvitation(invitation.id, acme.organizationId)).toBeUndefined();
    expect(revokeInvitation(invitation.id, demo.organizationId)).toEqual({
      id: invitation.id,
      email: 'newcomer@northstar.test',
      teamId: demo.teamId,
      role: 'viewer',
    });
    expect(inspectInvitation(invitation.tokenHash)).toBeNull();
    expect(revokeInvitation(invitation.id, demo.organizationId)).toBeUndefined();

    const accepted = invite({ email: users.acmeViewer.email });
    acceptInvitation({ tokenHash: accepted.tokenHash, existingUserId: users.acmeViewer.id });
    expect(revokeInvitation(accepted.id, demo.organizationId)).toBeUndefined();
    expect(count('invitations', 'WHERE id = ?', accepted.id)).toBe(1);
  });
});
