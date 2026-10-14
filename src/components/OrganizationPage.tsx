import { useEffect, useState, type FormEvent } from 'react';
import type { OrganizationMember, PendingInvitation, Team } from '../../shared/network.ts';
import { hasPermission } from '../../shared/permissions.ts';
import { api, ApiError } from '../api/client.ts';
import type { OrganizationMembership, Session } from '../types.ts';
import { InvitePanel } from './InvitePanel.tsx';
import { MembersPanel } from './MembersPanel.tsx';
import { OrganizationList } from './OrganizationList.tsx';
import { roleDescriptions } from '../lib/roles.ts';
import { RoleBadge } from './RoleBadge.tsx';
import { TeamsPanel } from './TeamsPanel.tsx';

type OrganizationPageProps = {
  user: Session['user'];
  organizations: OrganizationMembership[];
  organizationId: string;
  onSelectOrganization: (organizationId: string) => void;
  /** Re-reads the session so organization names and the engineer's own roles stay current. */
  onSessionChanged: () => Promise<void>;
  onLogout: () => void;
  /** Incremented when the engineer asked to create an organization; 0 when browsing normally. */
  createRequest: number;
};

export function OrganizationPage(props: OrganizationPageProps) {
  const {
    user,
    organizations,
    organizationId,
    onSelectOrganization,
    onSessionChanged,
    onLogout,
    createRequest,
  } = props;
  const membership = organizations.find((organization) => organization.id === organizationId);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loadedFor, setLoadedFor] = useState('');
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const role = membership?.role;
  const canManageMembers = hasPermission(role, 'members.manage');

  useEffect(() => {
    if (!organizationId || !membership) return;
    let active = true;
    async function load() {
      setError('');
      try {
        const [memberResult, teamResult, invitationResult] = await Promise.all([
          api.members(organizationId),
          api.teams(organizationId),
          canManageMembers ? api.pendingInvitations(organizationId) : Promise.resolve({ data: [] }),
        ]);
        if (!active) return;
        setMembers(memberResult.data);
        setTeams(teamResult.data);
        setInvitations(invitationResult.data);
        setLoadedFor(organizationId);
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 401) {
          onLogout();
          return;
        }
        if (active) setError(reason instanceof Error ? reason.message : 'Could not load the organization.');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [organizationId, membership, canManageMembers, version, onLogout]);

  async function reload(affectsSession: boolean) {
    setVersion((value) => value + 1);
    if (affectsSession) await onSessionChanged();
  }

  async function created(newOrganizationId: string) {
    await onSessionChanged();
    onSelectOrganization(newOrganizationId);
  }

  if (!organizationId || !membership || !role) {
    return (
      <OrganizationList
        key={createRequest}
        organizations={organizations}
        onSelect={onSelectOrganization}
        onCreated={created}
        defaultCreating={createRequest > 0}
      />
    );
  }

  const ready = loadedFor === organizationId;
  const owners = members.filter((member) => member.role === 'owner' && member.isActive);

  return (
    <>
      <OrganizationHeader
        membership={membership}
        owners={owners}
        memberCount={members.length}
        teamCount={teams.length}
        onRenamed={() => reload(true)}
      />
      {error && <div className="data-error">{error}</div>}
      {ready && (
        <>
          <MembersPanel
            organizationId={organizationId}
            role={role}
            currentUserId={user.id}
            members={members}
            teams={teams}
            onChanged={(affectsCurrentUser) => void reload(affectsCurrentUser)}
          />
          <TeamsPanel
            organizationId={organizationId}
            role={role}
            teams={teams}
            members={members}
            onChanged={() => void reload(false)}
          />
          {canManageMembers && (
            <PendingInvitations
              organizationId={organizationId}
              invitations={invitations}
              onChanged={() => void reload(false)}
            />
          )}
          <InvitePanel organizationId={organizationId} role={role} onInvited={() => void reload(false)} />
        </>
      )}
    </>
  );
}

function OrganizationHeader({
  membership,
  owners,
  memberCount,
  teamCount,
  onRenamed,
}: {
  membership: OrganizationMembership;
  owners: OrganizationMember[];
  memberCount: number;
  teamCount: number;
  onRenamed: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(membership.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRename = hasPermission(membership.role, 'organization.update');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.updateOrganization(membership.id, { name: name.trim() });
      setEditing(false);
      await onRenamed();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not rename the organization.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel organization-header">
      <div className="panel-header">
        <div>
          <h2>{membership.name}</h2>
          <p>
            Your role: <RoleBadge role={membership.role} /> — {roleDescriptions[membership.role]}
          </p>
        </div>
        {canRename && !editing && (
          <button
            className="outline-button"
            onClick={() => {
              setName(membership.name);
              setEditing(true);
            }}
          >
            Rename
          </button>
        )}
      </div>
      {editing && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Organization name
            <input
              required
              maxLength={160}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save name'}
            </button>
          </div>
        </form>
      )}
      <div className="organization-facts">
        <div>
          <b>{memberCount}</b>
          <small>{memberCount === 1 ? 'member' : 'members'}</small>
        </div>
        <div>
          <b>{teamCount}</b>
          <small>{teamCount === 1 ? 'team' : 'teams'}</small>
        </div>
        <div className="organization-owners">
          <b>{owners.length ? owners.map((owner) => owner.displayName).join(', ') : '—'}</b>
          <small>{owners.length === 1 ? 'owner' : 'owners'}</small>
        </div>
      </div>
    </section>
  );
}

function PendingInvitations({
  organizationId,
  invitations,
  onChanged,
}: {
  organizationId: string;
  invitations: PendingInvitation[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  async function revoke(invitation: PendingInvitation) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}? The link will stop working.`)) return;
    setBusyId(invitation.id);
    setError('');
    try {
      await api.revokeInvitation(invitation.id, organizationId);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not revoke the invitation.');
    } finally {
      setBusyId('');
    }
  }
  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>
            Pending invitations <span className="subtle-count">{invitations.length}</span>
          </h2>
          <p>Links that have not been accepted yet. Revoking a link stops it from working.</p>
        </div>
      </div>
      {error && <div className="data-error">{error}</div>}
      {!invitations.length && <p>No pending invitations.</p>}
      {invitations.map((invitation) => (
        <div className="network-management-row" key={invitation.id}>
          <div>
            <b>
              {invitation.email} <RoleBadge role={invitation.role} />
            </b>
            <small>
              {invitation.teamName} · invited by {invitation.invitedBy.displayName} · expires{' '}
              {new Date(invitation.expiresAt).toLocaleDateString()}
            </small>
          </div>
          <button
            className="text-button danger-text"
            disabled={busyId === invitation.id}
            onClick={() => void revoke(invitation)}
          >
            {busyId === invitation.id ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      ))}
    </section>
  );
}
