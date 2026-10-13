import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import type { Team } from '../../shared/network.ts';
import type { OrganizationRole } from '../types.ts';

type InviteRole = Exclude<OrganizationRole, 'owner'>;

export function InvitePanel({ organizationId, role }: { organizationId: string; role: OrganizationRole }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadedOrganizationId, setLoadedOrganizationId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<InviteRole>('viewer');
  const [inviteUrl, setInviteUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    if (!organizationId) {
      return () => {
        active = false;
      };
    }
    api
      .teams(organizationId)
      .then((result) => {
        if (active) {
          setTeams(result.data);
          setTeamId(result.data[0]?.id ?? '');
          setLoadedOrganizationId(organizationId);
        }
      })
      .catch(() => {
        if (active) setMessage('Could not load teams.');
      });
    return () => {
      active = false;
    };
  }, [organizationId]);
  const availableTeams = loadedOrganizationId === organizationId ? teams : [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setInviteUrl('');
    try {
      const result = await api.createInvitation({
        organizationId,
        teamId,
        email,
        role: inviteRole,
      });
      setInviteUrl(result.inviteUrl);
      setMessage('Invitation link created. Copy and send it to your teammate.');
      setEmail('');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not create invitation.');
    } finally {
      setBusy(false);
    }
  }
  if (role !== 'owner' && role !== 'admin')
    return (
      <section className="panel invite-panel">
        <h2>Team invitations</h2>
        <p>An organization admin can invite engineers to this organization.</p>
      </section>
    );
  return (
    <section className="panel invite-panel">
      <h2>Invite an engineer</h2>
      <p>Invitations are for one person and one team. The link expires in seven days.</p>
      {!organizationId && (
        <div className="auth-error">Select an organization above before creating an invite.</div>
      )}
      <form className="invite-form" onSubmit={submit}>
        <label>
          Email address
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>
          Team
          <select
            value={teamId}
            onChange={(event) => setTeamId(event.target.value)}
            required
            disabled={!availableTeams.length}
          >
            {availableTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Role
          <select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}>
            <option value="viewer">Viewer</option>
            <option value="operator">Operator</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button
          className="primary-button"
          type="submit"
          disabled={busy || !organizationId || !teamId || !availableTeams.length}
        >
          {busy ? 'Creating…' : 'Create invite link'}
        </button>
      </form>
      {message && <div className={inviteUrl ? 'invite-success' : 'auth-error'}>{message}</div>}
      {inviteUrl && (
        <div className="invite-link">
          <input readOnly value={inviteUrl} />
          <button
            className="outline-button"
            type="button"
            onClick={() => void navigator.clipboard.writeText(inviteUrl)}
          >
            Copy link
          </button>
        </div>
      )}
    </section>
  );
}
