import { useState, type FormEvent } from 'react';
import { api } from '../api/client.ts';
import { roleDescriptions } from '../lib/roles.ts';
import type { OrganizationMembership } from '../types.ts';
import { RoleBadge } from './RoleBadge.tsx';

/**
 * Every organization the signed-in account belongs to, and the explicit, owner-controlled way to
 * start another one: the creator becomes the owner through the organization's first team, and
 * nobody else gains access until they are invited.
 */
export function OrganizationList({
  organizations,
  onSelect,
  onCreated,
  defaultCreating = false,
}: {
  organizations: OrganizationMembership[];
  onSelect: (organizationId: string) => void;
  onCreated: (organizationId: string) => Promise<void> | void;
  /** Open the creation form immediately instead of behind the header button. */
  defaultCreating?: boolean;
}) {
  const [creating, setCreating] = useState(defaultCreating);
  const [name, setName] = useState('');
  const [teamName, setTeamName] = useState('Owners');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function cancel() {
    setCreating(false);
    setName('');
    setTeamName('Owners');
    setError('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api.createOrganization({
        name: name.trim(),
        teamName: teamName.trim() || 'Owners',
      });
      cancel();
      await onCreated(result.data.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create the organization.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>
            Your organizations <span className="subtle-count">{organizations.length}</span>
          </h2>
          <p>
            One account, any number of organizations. Open one to manage its teams and members, or start a new
            organization that you will own.
          </p>
        </div>
        {!creating && (
          <button className="primary-button" onClick={() => setCreating(true)}>
            <span>＋</span>New organization
          </button>
        )}
      </div>
      {!organizations.length && !creating && <p>You do not belong to any organization yet.</p>}
      {organizations.map((organization) => (
        <div className="network-management-row" key={organization.id}>
          <div>
            <b>{organization.name}</b>
            <small>{roleDescriptions[organization.role]}</small>
          </div>
          <div className="management-actions">
            <RoleBadge role={organization.role} />
            <button className="text-button" onClick={() => onSelect(organization.id)}>
              Open <span>→</span>
            </button>
          </div>
        </div>
      ))}
      {creating && (
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
          <label>
            First team
            <input maxLength={120} value={teamName} onChange={(event) => setTeamName(event.target.value)} />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={cancel}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Creating…' : 'Create organization'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
