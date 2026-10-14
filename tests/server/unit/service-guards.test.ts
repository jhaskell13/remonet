import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../server/auth.ts';
import { AppError } from '../../../server/http/app-error.ts';
import { auditFor } from '../../../server/modules/audit/audit.service.ts';
import {
  acceptInvite,
  createInvite,
  pendingInvitesFor,
  revokeInvite,
} from '../../../server/modules/invitations/invitation.service.ts';
import {
  createNetworkFor,
  deleteDeviceFor,
  enrollDeviceFor,
} from '../../../server/modules/networks/network.service.ts';
import {
  createOrganizationFor,
  membersFor,
  updateOrganizationFor,
} from '../../../server/modules/organizations/organization.service.ts';
import { addMemberFor, createTeamFor, removeMemberFor } from '../../../server/modules/teams/team.service.ts';
import * as invitationRepository from '../../../server/persistence/repositories/invitation-repository.ts';
import * as userRepository from '../../../server/persistence/repositories/user-repository.ts';
import { hashInvitationToken } from '../../../server/auth.ts';
import { useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo } = fixtures;

// Services are called directly, bypassing the HTTP layer, to prove that every use case enforces
// its own rules even if a route guard were misconfigured.
const service: Principal = {
  id: 'service-token',
  email: '',
  displayName: 'API integration',
  organizations: [{ id: demo.organizationId, name: 'Northstar Engineering', role: 'viewer' }],
  serviceToken: true,
};
const owner: Principal = {
  id: users.nsOwner.id,
  email: users.nsOwner.email,
  displayName: users.nsOwner.displayName,
  organizations: [{ id: demo.organizationId, name: 'Northstar Engineering', role: 'owner' }],
  sessionToken: 'token',
};

function refusal(fn: () => unknown) {
  try {
    fn();
    return undefined;
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { status: error.statusCode, message: error.message };
  }
}

describe('service-level guards for the integration token', () => {
  const db = useSeededDatabase();
  afterEach(() => vi.restoreAllMocks());

  it.each<[string, () => unknown]>([
    ['create organization', () => createOrganizationFor(service, { name: 'X' })],
    ['rename organization', () => updateOrganizationFor(service, demo.organizationId, { name: 'X' })],
    ['read members', () => membersFor(service, demo.organizationId)],
    ['create team', () => createTeamFor(service, { organizationId: demo.organizationId, name: 'X' })],
    [
      'add member',
      () =>
        addMemberFor(service, demo.secondTeamId, {
          organizationId: demo.organizationId,
          userId: users.nsViewer.id,
          role: 'viewer',
        }),
    ],
    [
      'remove member',
      () => removeMemberFor(service, demo.teamId, users.nsViewer.id, { organizationId: demo.organizationId }),
    ],
    [
      'create invitation',
      () =>
        createInvite(service, {
          email: 'x@northstar.test',
          organizationId: demo.organizationId,
          teamId: demo.teamId,
          role: 'viewer',
        }),
    ],
    ['list invitations', () => pendingInvitesFor(service, demo.organizationId)],
    ['revoke invitation', () => revokeInvite(service, 'inv', { organizationId: demo.organizationId })],
  ])('%s is refused', (_name, attempt) => {
    expect(refusal(attempt)).toEqual({ status: 403, message: 'Engineer account required' });
  });

  it('network, device, and audit use cases keep their specific refusals', () => {
    expect(
      refusal(() =>
        createNetworkFor(service, { organizationId: demo.organizationId, name: 'X', description: '' }),
      ),
    ).toEqual({
      status: 403,
      message: 'Engineer account required to manage networks',
    });
    expect(
      refusal(() => deleteDeviceFor(service, demo.coreRouterId, { organizationId: demo.organizationId })),
    ).toEqual({
      status: 403,
      message: 'Engineer account required to manage networks',
    });
    expect(
      refusal(() =>
        enrollDeviceFor(service, {
          organizationId: demo.organizationId,
          networkId: demo.coreNetworkId,
          areaId: demo.dataCenterAreaId,
          name: 'X',
          type: 'Router',
          address: '10.0.0.9',
        }),
      ),
    ).toEqual({ status: 403, message: 'Organization access denied' });
    expect(refusal(() => auditFor(service, {}))).toEqual({
      status: 403,
      message: 'Engineer account required to read the audit trail',
    });
    expect(refusal(() => acceptInvite(service, { token: 'x' }))).toEqual({
      status: 404,
      message: 'Invitation is invalid or expired',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
  });

  it('a stale session whose organization disappeared cannot act on it', () => {
    // The principal object is built per request; here it claims ownership of an organization that
    // was removed in between (cascading its teams and memberships).
    db.prepare("DELETE FROM organizations WHERE id = 'org-solo'").run();
    const stale: Principal = { ...owner, organizations: [{ id: 'org-solo', name: 'Gone', role: 'owner' }] };
    expect(refusal(() => updateOrganizationFor(stale, 'org-solo', { name: 'Resurrected' }))).toEqual({
      status: 404,
      message: 'Organization not found',
    });
    // Writes that would dangle are stopped by the schema itself (surfacing as a generic 500).
    expect(() => createTeamFor(stale, { organizationId: 'org-solo', name: 'X' })).toThrow(/FOREIGN KEY/);
  });
});

describe('invitation acceptance maps repository failures to HTTP outcomes', () => {
  const db = useSeededDatabase();
  afterEach(() => vi.restoreAllMocks());

  function pendingToken(email: string) {
    const token = `token-${Math.random().toString(36).slice(2)}`;
    db.prepare(
      "INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, 'org-demo', 'team-northstar', 'viewer', ?, ?, ?, ?)",
    ).run(
      `inv-${token}`,
      email,
      hashInvitationToken(token),
      users.nsOwner.id,
      new Date().toISOString(),
      new Date(Date.now() + 60_000).toISOString(),
    );
    return token;
  }

  it('a signed-in account that was deactivated mid-flight is refused', () => {
    const token = pendingToken(users.acmeViewer.email);
    db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(users.acmeViewer.id);
    const principal: Principal = {
      id: users.acmeViewer.id,
      email: users.acmeViewer.email,
      displayName: 'Acme Viewer',
      organizations: [],
    };
    expect(refusal(() => acceptInvite(principal, { token }))).toEqual({
      status: 403,
      message: 'Sign in with the invited email address to accept this invitation',
    });
  });

  it('an account created concurrently for the invited address is reported as a conflict', () => {
    const token = pendingToken('race@northstar.test');
    vi.spyOn(invitationRepository, 'acceptInvitation').mockImplementationOnce(() => {
      throw new Error('ACCOUNT_EXISTS');
    });
    expect(
      refusal(() => acceptInvite(null, { token, displayName: 'Race', password: 'LongEnoughPassword!' })),
    ).toEqual({
      status: 409,
      message: 'This email already has an account. Sign in to accept the invitation.',
    });
  });

  it('an invitation consumed concurrently is reported as invalid', () => {
    const token = pendingToken(users.acmeViewer.email);
    vi.spyOn(invitationRepository, 'acceptInvitation').mockImplementationOnce(() => {
      throw new Error('INVITATION_INVALID');
    });
    const principal: Principal = {
      id: users.acmeViewer.id,
      email: users.acmeViewer.email,
      displayName: 'Acme Viewer',
      organizations: [],
    };
    expect(refusal(() => acceptInvite(principal, { token }))).toEqual({
      status: 404,
      message: 'Invitation is invalid or expired',
    });
  });

  it('unexpected storage failures never expose internals', () => {
    const token = pendingToken('race@northstar.test');
    vi.spyOn(invitationRepository, 'acceptInvitation').mockImplementationOnce(() => {
      throw new Error('SQLITE_BUSY: database is locked');
    });
    expect(
      refusal(() => acceptInvite(null, { token, displayName: 'Race', password: 'LongEnoughPassword!' })),
    ).toEqual({
      status: 409,
      message: 'Could not accept invitation',
    });
    vi.spyOn(invitationRepository, 'acceptInvitation').mockImplementationOnce(() => {
      throw 'not an error object';
    });
    expect(
      refusal(() => acceptInvite(null, { token, displayName: 'Race', password: 'LongEnoughPassword!' }))
        ?.status,
    ).toBe(409);
  });

  it('an account that vanished right after acceptance rolls the acceptance back', () => {
    const token = pendingToken('race@northstar.test');
    vi.spyOn(userRepository, 'getUserById').mockReturnValueOnce(null);
    expect(
      refusal(() => acceptInvite(null, { token, displayName: 'Race', password: 'LongEnoughPassword!' })),
    ).toEqual({
      status: 404,
      message: 'Invitation is invalid or expired',
    });
    expect(db.prepare("SELECT 1 FROM users WHERE email = 'race@northstar.test'").get()).toBeUndefined();
    expect(
      db
        .prepare('SELECT accepted_at AS acceptedAt FROM invitations WHERE token_hash = ?')
        .get(hashInvitationToken(token)),
    ).toEqual({ acceptedAt: null });
  });
});
