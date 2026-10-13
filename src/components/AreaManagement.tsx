import { useState, type FormEvent } from 'react';
import type { Area, Network } from '../../shared/network.ts';
import { api, ApiError } from '../api/client.ts';

type AreaManagementProps = {
  areas: Area[];
  network: Network | undefined;
  canManage: boolean;
  onChanged: () => void;
};

export function AreaManagement({ areas, network, canManage, onChanged }: AreaManagementProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [region, setRegion] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function startEditing(area?: Area) {
    setEditingId(area?.id ?? 'new');
    setName(area?.name ?? '');
    setRegion(area?.region ?? '');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!network) return;
    setSaving(true);
    setError('');
    try {
      const input = {
        organizationId: network.organizationId,
        networkId: network.id,
        name: name.trim(),
        region: region.trim(),
      };
      if (editingId === 'new') await api.createArea(input);
      else if (editingId) await api.updateArea(editingId, input);
      setEditingId(null);
      onChanged();
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 409
          ? 'An area with that name already exists in this network.'
          : reason instanceof Error
            ? reason.message
            : 'Could not save the area.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel settings-panel network-management">
      <div className="panel-header">
        <div>
          <h2>Areas</h2>
          <p>{network ? `Locations within ${network.name}.` : 'Select a network to manage its areas.'}</p>
        </div>
        {network && canManage && !editingId && (
          <button className="primary-button" onClick={() => startEditing()}>
            <span>＋</span>Add area
          </button>
        )}
      </div>
      {network && !areas.length && !editingId && <p>No areas have been added to this network yet.</p>}
      {areas.map((area) => (
        <div className="network-management-row" key={area.id}>
          <div>
            <b>{area.name}</b>
            <small>{area.region}</small>
          </div>
          {canManage && network && !editingId && (
            <button className="text-button" onClick={() => startEditing(area)}>
              Edit
            </button>
          )}
        </div>
      ))}
      {editingId && network && (
        <form className="network-form" onSubmit={(event) => void submit(event)}>
          <label>
            Area name
            <input
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Region or location
            <input
              required
              maxLength={160}
              value={region}
              onChange={(event) => setRegion(event.target.value)}
            />
          </label>
          {error && <div className="data-error">{error}</div>}
          <div className="network-form-actions">
            <button className="outline-button" type="button" onClick={() => setEditingId(null)}>
              Cancel
            </button>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? 'Saving…' : editingId === 'new' ? 'Create area' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
