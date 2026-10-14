import { useState, type FormEvent } from 'react';
import type { AccessRole, OrganizationMember, Team } from '../../shared/network.ts';
import { hasPermission } from '../../shared/permissions.ts';
import { api, ApiError } from '../api/client.ts';

export function TeamsPanel({
  organizationId,
  role,
  teams,
  members,
  onChanged,
}: {
  organizationId: string;
  role: AccessRole;
  teams: Team[];
  members: OrganizationMember[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canManage = hasPermission(role, 'team.manage');
  const canDelete = hasPermission(role, 'team.delete');
  const memberCount = (teamId: string) =>
    members.filter((member) => member.teams.some((membership) => membership.teamId === teamId)).length;

  function startEditing(team?: Team) {
    setEditingId(team?.id ?? 'new');
    setName(team?.name ?? '');
    setError('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (editingId === 'new') await api.createTeam({ organizationId, name: name.trim() });
      else if (editingId) await api.updateTeam(editingId, { organizationId, name: name.trim() });
      setEditingId(null);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'A team with that name already exists in this organization.'
          : reason instanceof Error
            ? reason.message
            : 'Could not save the team.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function removeTeam(team: Team) {
    if (!window.confirm(`Delete the team “${team.name}”? Pending invitations to it will be discarded.`))
      return;
    setBusy(true);
    setError('');
    try {
      await api.deleteTeam(team.id, organizationId);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete the team.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>
            Teams <span className="subtle-count">{teams.length}</span>
          </h2>
          <p>Membership in any team of the organization grants access; roles are set per team.</p>
        </div>
        {canManage && !editingId && (
          <button className="primary-button" onClick={() => startEditing()}>
            <span>＋</span>Add team
          </button>
        )}
      </div>
      {error && !editingId && <div className="data-error">{error}</div>}
      {teams.map((team) => (
        <div className="network-management-row" key={team.id}>
          <div>
            <b>{team.name}</b>
            <small>
              {memberCount(team.id)} {memberCount(team.id) === 1 ? 'member' : 'members'}
            </small>
          </div>
          <div className="management-actions">
            {canManage && !editingId && (
              <button className="text-button" onClick={() => startEditing(team)}>
                Rename
              </button>
            )}
            {canDelete && !editingId && (
              <button
                className="text-button danger-text"
                disabled={busy || memberCount(team.id) > 0}
                title={
                  memberCount(team.id) > 0 ? 'Remove the members of this team before deleting it' : undefined
                }
                onClick={() => void removeTeam(team)}
              >
                Delete
              </button>
            )}
          </div>
        </div>
      ))}
      {editingId && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Team name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'Saving…' : editingId === 'new' ? 'Create team' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
