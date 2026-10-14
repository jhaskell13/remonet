import { useState } from 'react';
import type { AccessRole, OrganizationMember, Team } from '../../shared/network.ts';
import { assignableRoles, canActOnRole, hasPermission } from '../../shared/permissions.ts';
import { api } from '../api/client.ts';
import { roleLabels } from '../lib/roles.ts';
import { RoleBadge } from './RoleBadge.tsx';

export function MembersPanel({
  organizationId,
  role,
  currentUserId,
  members,
  teams,
  onChanged,
}: {
  organizationId: string;
  role: AccessRole;
  currentUserId: string;
  members: OrganizationMember[];
  teams: Team[];
  onChanged: (affectsCurrentUser: boolean) => void;
}) {
  const [error, setError] = useState('');
  const [busyKey, setBusyKey] = useState('');
  const [addingFor, setAddingFor] = useState<string | null>(null);
  const [addTeamId, setAddTeamId] = useState('');
  const [addRole, setAddRole] = useState<AccessRole>('viewer');
  const canManage = hasPermission(role, 'members.manage');
  const grantable = assignableRoles(role);

  async function run(key: string, action: () => Promise<unknown>, affectsCurrentUser: boolean) {
    setBusyKey(key);
    setError('');
    try {
      await action();
      onChanged(affectsCurrentUser);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved.');
    } finally {
      setBusyKey('');
    }
  }
  function changeRole(member: OrganizationMember, teamId: string, nextRole: AccessRole) {
    void run(
      `${member.userId}:${teamId}`,
      () => api.changeMemberRole(teamId, member.userId, { organizationId, role: nextRole }),
      member.userId === currentUserId,
    );
  }
  function remove(member: OrganizationMember, teamId: string, teamName: string) {
    const self = member.userId === currentUserId;
    const question = self
      ? `Leave the team “${teamName}”?`
      : `Remove ${member.displayName} from “${teamName}”?`;
    if (!window.confirm(question)) return;
    void run(
      `${member.userId}:${teamId}`,
      () => api.removeMember(teamId, member.userId, organizationId),
      self,
    );
  }
  function startAdding(member: OrganizationMember) {
    const available = teams.filter(
      (team) => !member.teams.some((membership) => membership.teamId === team.id),
    );
    setAddingFor(member.userId);
    setAddTeamId(available[0]?.id ?? '');
    setAddRole(grantable.includes('viewer') ? 'viewer' : (grantable[0] ?? 'viewer'));
    setError('');
  }
  function addToTeam(member: OrganizationMember) {
    if (!addTeamId) return;
    void run(
      `add:${member.userId}`,
      async () => {
        await api.addMember(addTeamId, { organizationId, userId: member.userId, role: addRole });
        setAddingFor(null);
      },
      member.userId === currentUserId,
    );
  }

  return (
    <section className="panel settings-panel network-management members-panel">
      <div className="panel-header">
        <div>
          <h2>
            Members <span className="subtle-count">{members.length}</span>
          </h2>
          <p>
            One account per person, whatever the number of teams or organizations. A member’s role in the
            organization is the highest of their team roles.
          </p>
        </div>
      </div>
      {error && <div className="data-error">{error}</div>}
      {members.map((member) => {
        const self = member.userId === currentUserId;
        const manageable = canManage && canActOnRole(role, member.role);
        const availableTeams = teams.filter(
          (team) => !member.teams.some((membership) => membership.teamId === team.id),
        );
        return (
          <div className="member-row" key={member.userId}>
            <div className="member-identity">
              <div className="avatar">{member.displayName.slice(0, 2).toUpperCase()}</div>
              <div>
                <b>
                  {member.displayName}
                  {self && <span className="member-you">you</span>}
                  {!member.isActive && <span className="member-inactive">deactivated</span>}
                </b>
                <small>{member.email}</small>
              </div>
              <RoleBadge role={member.role} />
            </div>
            <div className="member-teams">
              {member.teams.map((membership) => {
                const key = `${member.userId}:${membership.teamId}`;
                const editable = manageable && grantable.includes(membership.role);
                return (
                  <div className="member-team" key={membership.teamId}>
                    <span className="member-team-name">{membership.teamName}</span>
                    {editable ? (
                      <select
                        aria-label={`Role of ${member.displayName} in ${membership.teamName}`}
                        value={membership.role}
                        disabled={busyKey === key}
                        onChange={(event) =>
                          changeRole(member, membership.teamId, event.target.value as AccessRole)
                        }
                      >
                        {grantable.map((option) => (
                          <option key={option} value={option}>
                            {roleLabels[option]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={membership.role} />
                    )}
                    {(editable || self) && (
                      <button
                        className="text-button danger-text"
                        disabled={busyKey === key}
                        onClick={() => remove(member, membership.teamId, membership.teamName)}
                      >
                        {self ? 'Leave' : 'Remove'}
                      </button>
                    )}
                  </div>
                );
              })}
              {manageable && availableTeams.length > 0 && addingFor !== member.userId && (
                <button className="text-button" onClick={() => startAdding(member)}>
                  ＋ Add to team
                </button>
              )}
              {addingFor === member.userId && (
                <div className="member-team member-add">
                  <select
                    aria-label="Team"
                    value={addTeamId}
                    onChange={(event) => setAddTeamId(event.target.value)}
                  >
                    {availableTeams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Role"
                    value={addRole}
                    onChange={(event) => setAddRole(event.target.value as AccessRole)}
                  >
                    {grantable.map((option) => (
                      <option key={option} value={option}>
                        {roleLabels[option]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary-button"
                    disabled={busyKey === `add:${member.userId}` || !addTeamId}
                    onClick={() => addToTeam(member)}
                  >
                    Add
                  </button>
                  <button className="outline-button" onClick={() => setAddingFor(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
