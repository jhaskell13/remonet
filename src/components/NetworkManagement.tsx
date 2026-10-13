import { useState, type FormEvent } from 'react';
import type { Network } from '../../shared/network.ts';
import { api, ApiError } from '../api/client.ts';

type NetworkManagementProps = {
  networks: Network[];
  organizationId: string;
  canManage: boolean;
  onChanged: () => void;
};

export function NetworkManagement({
  networks,
  organizationId,
  canManage,
  onChanged,
}: NetworkManagementProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const visibleNetworks = networks.filter((network) => network.organizationId === organizationId);

  function startEditing(network?: Network) {
    setEditingId(network?.id ?? 'new');
    setName(network?.name ?? '');
    setDescription(network?.description ?? '');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError('');
    try {
      const input = { organizationId, name: name.trim(), description: description.trim() };
      if (editingId === 'new') await api.createNetwork(input);
      else if (editingId) await api.updateNetwork(editingId, input);
      setEditingId(null);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'A network with that name already exists in this organization.'
          : reason instanceof Error
            ? reason.message
            : 'Could not save the network.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>Networks</h2>
          <p>Manage the networks in the selected organization.</p>
        </div>
        {canManage && organizationId && !editingId && (
          <button className="primary-button" onClick={() => startEditing()}>
            <span>＋</span>Add network
          </button>
        )}
      </div>
      {!organizationId && <p>Select an organization to manage its networks.</p>}
      {organizationId && !visibleNetworks.length && !editingId && (
        <p>No networks have been added to this organization yet.</p>
      )}
      {visibleNetworks.map((network) => (
        <div className="network-management-row" key={network.id}>
          <div>
            <b>{network.name}</b>
            <small>{network.description || 'No description'}</small>
          </div>
          {canManage && !editingId && (
            <button className="text-button" onClick={() => startEditing(network)}>
              Edit
            </button>
          )}
        </div>
      ))}
      {editingId && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Network name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Description
            <textarea
              maxLength={500}
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create network' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
